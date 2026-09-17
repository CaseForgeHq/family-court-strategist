import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { CaseDatabase } from './case-database.js';
import { FileReferences, isFileReference } from './file-references.js';
import { safePath, readLocal, writeNew } from './files.js';
import { AppError } from './errors.js';
import { readDocument, validateImport } from './document-readers.js';
import { analyseDocument, reportMarkdown, validateJurisdiction } from './scan-analysis.js';

const ID=/^[a-f0-9]{64}$/;
const now=()=>new Date().toISOString();
const scheduler={running:new Map(),waiting:[],pumping:false,sequence:Date.now()};
function pump() {
  if(scheduler.pumping)return;scheduler.pumping=true;
  try {
    scheduler.waiting.sort((a,b)=>a.job.position-b.job.position);
    while(scheduler.running.size < 3 && scheduler.waiting.length) {
      const entry=scheduler.waiting.shift();
      if(entry.owner.closed || entry.job.state !== 'queued')continue;
      scheduler.running.set(entry.key,entry);
      const task=entry.owner.run(entry).finally(()=>{scheduler.running.delete(entry.key);pump();});
      entry.owner.tasks.add(task);task.finally(()=>entry.owner.tasks.delete(task));
    }
  } finally {scheduler.pumping=false;}
}
function publicJob(job) {
  if(!job)return null;
  const {checkpoint,...value}=job;
  const waiting=scheduler.waiting.filter(e=>e.job.state==='queued').sort((a,b)=>a.job.position-b.job.position);
  const index=waiting.findIndex(e=>e.job.id===job.id);
  return {...value,queuePosition:index<0 ? null:index+1,elapsedMs:(job.elapsedMs || 0)+(job.startedAt ? Math.max(0,Date.now()-Date.parse(job.startedAt)):0)};
}
const jobSummary=job=>{if(!job)return null;const {checkpoint,...summary}=job;return summary;};
const reportSummary=report=>({id:report.id,documentId:report.documentId,createdAt:report.createdAt,version:report.version,schemaVersion:report.schemaVersion,legacy:Boolean(report.legacy)});
export class FilesAI {
  constructor({assertWritable,getAccess=()=>({canWrite:true}),fileReferences,scan,read=readDocument,analyse=analyseDocument,readerOptions={},fetchImpl=fetch,heartbeatMs=5000,monotonicNow=()=>performance.now()}) {
    Object.assign(this,{assertWritable,getAccess,fileReferences,scan,read,analyse,readerOptions,fetchImpl,monotonicNow});this.heartbeatMs=Math.max(100,heartbeatMs);
    this.cases=new Map();this.opening=new Map();this.tasks=new Set();this.closed=false;this.serial=Promise.resolve();
  }
  get tail() { return this.closePromise || this.drain(); }
  drain() { return Promise.allSettled([this.serial,...this.tasks]).then(()=>this.tasks.size ? this.drain():undefined); }
  async open(root) {
    if(this.closed)throw new AppError('The workspace is closing.',503);
    if(this.cases.has(root))return this.cases.get(root);
    if(this.opening.has(root))return this.opening.get(root);
    const opening=(async()=>{
      const writable=this.getAccess(root).canWrite===true, db=new CaseDatabase(root,{writable});
      try {
        const ready=await db.ready;
        const snapshot=ready.legacy ? {documents:ready.legacy.map(e=>e.record),scans:[],settings:null}:await db.call('snapshot');
        const state={db,writable,legacy:Boolean(ready.legacy),documents:new Map(snapshot.documents.map(d=>[d.id,d])),jobs:new Map(snapshot.scans.map(j=>[j.documentId,j])),extractions:new Map(),reports:new Map(),reportSummaries:new Map(),settings:snapshot.settings,caseId:snapshot.caseId};
        for(const summary of snapshot.reports || [])state.reportSummaries.set(summary.documentId,[...(state.reportSummaries.get(summary.documentId)||[]),summary]);
        for(const old of ready.legacy || []) {state.extractions.set(old.record.id,{pages:old.pages || [],coverage:{complete:false},images:[]});state.reports.set(old.record.id,old.draft ? [{...old.draft,legacy:true}]:[]);}
        for(const record of state.documents.values()) {
          if(writable && !isFileReference(record.reference)) {this.assertWritable(root);record.reference=this.references(root).allocate(record.id);await db.call('document',{record});}
          if(ready.legacy)state.reportSummaries.set(record.id,(state.reports.get(record.id)||[]).map(reportSummary));
        }
        this.cases.set(root,state);return state;
      } catch(error){await db.close().catch(()=>{});throw error;}
    })();
    this.opening.set(root,opening);
    try{return await opening;}finally{this.opening.delete(root);}
  }
  references(root) {return this.fileReferences || new FileReferences({root,relativePath:'.case-forge/file-references.json'});}
  list(root) {
    const state=this.cases.get(root);if(!state)return [];
    return [...state.documents.values()].map(d=>({...d,scan:publicJob(state.jobs.get(d.id)),latestReportId:state.reportSummaries.get(d.id)?.find(r=>!r.legacy)?.id || null,legacyReport:state.reportSummaries.get(d.id)?.some(r=>r.legacy) || false})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  record(root,id) { if(!ID.test(id))throw new AppError('Document not found.',404);const record=this.cases.get(root)?.documents.get(id);if(!record)throw new AppError('Document not found.',404);return record; }
  async detail(root,id) {await this.open(root);const record=this.record(root,id),state=this.cases.get(root);const [extraction,reports]=state.legacy ? [state.extractions.get(id),state.reports.get(id)||[]]:await Promise.all([state.db.call('extraction',{id}),state.db.call('report',{id})]);return {...record,scan:publicJob(state.jobs.get(id)),pages:extraction?.pages || [],images:extraction?.images || [],coverage:extraction?.coverage || null,reports,draft:null,saved:null};}
  sourceRecords(root) {const state=this.cases.get(root);return this.list(root).map(d=>({...d,indexedPages:state.legacy ? state.extractions.get(d.id)?.pages || []:[],indexedReports:state.legacy ? state.reports.get(d.id) || []:[],fileTextIndexed:!state.legacy}));}
  exclusive(fn) {const task=this.serial.then(fn);this.serial=task.catch(()=>{});return task;}
  async import(root,filename,bytes,provenance=null) {
    await this.open(root);return this.exclusive(async()=>{
      this.assertWritable(root);
      let info;
      try {info=validateImport(filename,bytes);}catch(error) {
        if(!provenance || !bytes.length || bytes.length>512*1024*1024)throw error;
        info={name:String(filename).split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g,'').slice(0,180) || 'Unsupported attachment',extension:'.bin',format:'unsupported',readerError:error.message};
      }
      const id=createHash('sha256').update(bytes).digest('hex'),state=this.cases.get(root);
      if(state.documents.has(id)) {
        const record=state.documents.get(id);
        if(provenance && !(record.parents || []).some(p=>p.parentId===provenance.parentId && p.name===provenance.name)) {const updated={...record,parents:[...(record.parents || []),provenance]};await state.db.call('document',{record:updated});state.documents.set(id,updated);}
        return {document:await this.detail(root,id),duplicate:true};
      }
      const original=`.case-forge/originals/${id}/original${info.extension}`;
      if(!existsSync(safePath(root,original)))writeNew(root,original,bytes);
      else if(createHash('sha256').update(readLocal(root,original)).digest('hex')!==id)throw new AppError('The existing original needs recovery.',409);
      const record={...info,id,reference:this.references(root).allocate(id),bytes:bytes.length,original,status:info.format==='unsupported'?'unsupported':'ready',createdAt:now(),updatedAt:now(),parents:provenance ? [provenance]:[],error:info.readerError || null};
      this.assertWritable(root);await state.db.call('document',{record});state.documents.set(id,record);
      // Import is entirely local. Reading and AI begin only after Scan.
      return {document:record,duplicate:false};
    });
  }
  measureTime(entry,stop=false) {
    if(!entry || entry.elapsedTick==null)return;
    const tick=this.monotonicNow(),job=entry.job;
    job.elapsedMs=(job.elapsedMs || 0)+Math.max(0,tick-entry.elapsedTick);job.timingRecordedAt=now();
    job.startedAt=stop ? null:job.timingRecordedAt;entry.elapsedTick=stop ? null:tick;
  }
  async saveJob(root,job) {const state=this.cases.get(root),entry=scheduler.running.get(`${root}:${job.documentId}`);if(entry?.job===job)this.measureTime(entry);await state.db.call('scan',{job});state.jobs.set(job.documentId,jobSummary(job));return publicJob(job);}
  async enqueue(root,id,{rescan=false,jurisdiction}={}) {
    await this.open(root);return this.exclusive(async()=>{
      this.assertWritable(root);const record=this.record(root,id),state=this.cases.get(root),previous=state.jobs.get(id);
      if(previous && ['queued','running'].includes(previous.state))return publicJob(previous);
      if(previous?.state==='completed' && !rescan)return publicJob(previous);
      const job={id:randomUUID(),documentId:id,documentHash:id,state:'queued',position:++scheduler.sequence,stage:'Waiting to read',createdAt:now(),startedAt:null,completedAt:null,elapsedMs:0,error:null,checkpoint:{},jurisdiction:validateJurisdiction(jurisdiction || state.settings || {country:'AU',regions:['Commonwealth']})};
      await this.saveJob(root,job);this.schedule(root,job);return publicJob(job);
    });
  }
  schedule(root,job) {const key=`${root}:${job.documentId}`;if(scheduler.running.has(key) || scheduler.waiting.some(e=>e.key===key))return;scheduler.waiting.push({owner:this,root,job,key,controller:new AbortController()});queueMicrotask(pump);}
  async control(root,id,action,{jurisdiction}={}) {
    await this.open(root);this.assertWritable(root);const state=this.cases.get(root);this.record(root,id);
    if(state.backingUp)throw new AppError('The case backup is running. Wait before changing scan jobs.',409);
    const key=`${root}:${id}`,entry=scheduler.running.get(key) || scheduler.waiting.find(e=>e.key===key);
    const job=entry?.job || await state.db.call('getScan',{id});
    if(!job)throw new AppError('Scan this document from Case desk first.',409);
    if(action==='next') {if(job.state!=='queued')throw new AppError('Only waiting scans can be moved.',409);job.position=Math.min(...scheduler.waiting.map(e=>e.job.position),scheduler.sequence)-1;await this.saveJob(root,job);pump();return publicJob(job);}
    if(['pause','cancel'].includes(action)) {
      if(job.state==='completed')throw new AppError('This scan is already complete.',409);
      job.state=action==='pause' ? 'paused':'cancelled';job.error=action==='pause' ? 'Scan paused. Resume when ready.':'Scan cancelled. The original remains available.';
      entry?.controller.abort();scheduler.waiting=scheduler.waiting.filter(e=>e.key!==key);
      this.measureTime(entry,true);job.startedAt=null;
      return this.saveJob(root,job);
    }
    if(['resume','retry'].includes(action)) {
      if(['queued','running','completed'].includes(job.state))return publicJob(job);
      if(scheduler.running.has(key))throw new AppError('The previous request is stopping. Try again shortly.',409);
      if(action==='retry'){const extraction=await state.db.call('extraction',{id});job.checkpoint={usage:job.checkpoint.usage || [],extracted:Boolean(job.checkpoint.extracted && extraction?.coverage?.complete)};}
      if(jurisdiction) {job.jurisdiction=validateJurisdiction(jurisdiction);delete job.checkpoint.orientation;delete job.checkpoint.laws;delete job.checkpoint.legalDone;delete job.checkpoint.legalLimitations;delete job.checkpoint.diagnostics;}
      Object.assign(job,{state:'queued',position:++scheduler.sequence,error:null,startedAt:null});
      await this.saveJob(root,job);this.schedule(root,job);return publicJob(job);
    }
    throw new AppError('Unknown scan action.');
  }
  async run(entry) {
    const {root,job,controller}=entry,signal=controller.signal,state=this.cases.get(root);
    let heartbeat,heartbeatTask=null;
    const check=()=>{signal.throwIfAborted();if(this.closed)throw new AppError('Workspace closed.',423);this.assertWritable(root);};
    const checkpoint=async(stage,patch={})=>{check();job.stage=stage;Object.assign(job.checkpoint,patch);await this.saveJob(root,job);};
    try {
      check();Object.assign(job,{state:'running',startedAt:now(),error:null});entry.elapsedTick=this.monotonicNow();await this.saveJob(root,job);
      // The small timing row avoids rewriting large extraction/AI checkpoints.
      heartbeat=setInterval(()=>{
        if(job.state!=='running'||signal.aborted||heartbeatTask)return;
        this.measureTime(entry);state.jobs.set(job.documentId,jobSummary(job));
        heartbeatTask=state.db.call('timing',{id:job.documentId,jobId:job.id,elapsedMs:job.elapsedMs,recordedAt:job.timingRecordedAt}).catch(()=>{}).finally(()=>{heartbeatTask=null;});
      },this.heartbeatMs);heartbeat.unref();
      if(typeof this.scan!=='function')throw Object.assign(new AppError('Sign in with ChatGPT in the desktop app to scan this document.',409),{code:'sign_in_required'});
      const record=this.record(root,job.documentId),original=readLocal(root,record.original);
      if(createHash('sha256').update(original).digest('hex')!==job.documentHash)throw new AppError('The original changed. Reimport it before scanning.',409);
      let extraction=job.checkpoint.extracted ? await state.db.call('extraction',{id:record.id}):null;
      if(!extraction || extraction.reader?.name==='legacy' || !job.checkpoint.extracted) {
        await checkpoint('Reading document');
        extraction=await this.read({root,record,signal,...this.readerOptions,onProgress:message=>{job.stage=typeof message==='string'?message:message.stage || 'Reading document';state.jobs.set(job.documentId,jobSummary(job));}});
        check();await state.db.call('extraction',{id:record.id,value:extraction});
        for(const attachment of extraction.attachments || []) {check();await this.import(root,attachment.name,readLocal(root,attachment.path),{parentId:record.id,name:attachment.name,source:attachment.source});}
        await checkpoint('Understanding context',{extracted:true});
      }
      const report=await this.analyse({root,record,extraction,jurisdiction:job.jurisdiction,checkpoint:job.checkpoint,saveCheckpoint:checkpoint,scan:this.scan,signal,db:state.db,fetchImpl:this.fetchImpl,requestId:job.id});
      check();report.id=randomUUID();report.documentId=record.id;report.createdAt=now();report.schemaVersion=1;report.markdown=reportMarkdown(report,record);
      const path=`.case-forge/derived/${record.id}/reports/${report.id}.md`;writeNew(root,path,report.markdown);report.path=path;
      this.measureTime(entry,true);job.startedAt=null;job.completedAt=report.complete ? now():null;
      job.state=report.complete ? 'completed':'attention';job.stage=report.complete ? 'Scan completed':'Review required';job.error=report.complete ? null:report.attention.join(' ');job.reportId=report.id;
      check();const saved=await state.db.call('report',{id:record.id,report,job});state.reportSummaries.set(record.id,[reportSummary(saved),...(state.reportSummaries.get(record.id)||[])]);state.jobs.set(record.id,jobSummary(job));
    } catch(error) {
      if(!['paused','cancelled','interrupted'].includes(job.state)) {
        job.state=['sign_in_required','SCAN_SIGN_IN_REQUIRED'].includes(error.code) || /sign in|sign-in|authentication|log in/i.test(error.message) ? 'sign_in_required':error.code==='dependencies_missing' ? 'setup_required':['model_unavailable','SCAN_MODEL_UNAVAILABLE'].includes(error.code) ? 'attention':'failed';
        job.error=error.message || 'The scan could not finish.';
      }
      this.measureTime(entry,true);job.startedAt=null;
      // Persist interruption/error metadata even if the UI has just locked; no
      // model output is saved after cancellation or revoked write access.
      await this.saveJob(root,job).catch(()=>{});
    } finally {clearInterval(heartbeat);await heartbeatTask;}
  }
  async settings(root,value) {const state=await this.open(root);if(value!==undefined){this.assertWritable(root);state.settings=validateJurisdiction(value);await state.db.call('settings',{value:state.settings});}return state.settings || {country:'AU',regions:['Commonwealth']};}
  async search(root,query) {const state=await this.open(root);if((await state.db.ready).legacy)return [];return state.db.call('search',{query});}
  async searchDocuments(root,query,{history=false,mode='all',limit=10000}={}) {
    const state=await this.open(root);if(state.legacy)return {rows:[],total:0,revision:'legacy'};
    const result=await state.db.call('searchDocuments',{query,history,mode,limit});
    return {...result,rows:result.rows.map(row=>({...row,record:this.record(root,row.documentId),report:state.reportSummaries.get(row.documentId)?.find(r=>r.id===row.reportId),history:Boolean(row.reportId && state.reportSummaries.get(row.documentId)?.[0]?.id!==row.reportId)}))};
  }
  async backup(root) {
    const state=await this.open(root);this.assertWritable(root);
    return this.exclusive(async()=>{
      if([...scheduler.running.values(),...scheduler.waiting].some(e=>e.root===root))throw new AppError('Pause or finish scans before creating a consistent case backup.',409);
      state.backingUp=true;try{return await state.db.call('backup');}finally{state.backingUp=false;}
    });
  }
  async close() {
    if(this.closePromise)return this.closePromise;this.closed=true;
    this.closePromise=(async()=>{
      const stopped=[];
      scheduler.waiting=scheduler.waiting.filter(entry=>{if(entry.owner!==this)return true;entry.job.state='interrupted';entry.job.error='Workspace closed. Resume when ready.';stopped.push(this.saveJob(entry.root,entry.job));return false;});
      for(const entry of scheduler.running.values())if(entry.owner===this){entry.job.state='interrupted';entry.job.error='Workspace closed. Resume when ready.';entry.controller.abort();}
      await Promise.allSettled([...this.opening.values()]);
      await Promise.allSettled(stopped);
      await this.drain();
      for(const state of this.cases.values())await state.db.close();
    })();return this.closePromise;
  }
}
