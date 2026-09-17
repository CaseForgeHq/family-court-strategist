import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, readdirSync, lstatSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { safePath, readJson, readLocal, writeJson } from './files.js';

const { root, writable } = workerData;
const ID = /^[a-f0-9]{64}$/;
const stamp = () => new Date().toISOString();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function sourceAnchor(source) {return {...(source.anchor || {kind:'page',page:source.page}),sourcePage:source.page};}
function sourceLabel(source) {
  const a=source.anchor || {};
  if(a.label)return a.label;
  if(a.kind==='cell')return `${a.sheet ? `${a.sheet} · `:''}${a.cell || `row ${a.row}, column ${a.column}`}${a.locationBasis==='extracted-table'?' (extracted table)':''}`;
  if(a.kind==='paragraph')return `Paragraph ${a.paragraph}`;
  if(a.kind==='timestamp')return `${Math.floor(a.startMs/60000)}:${String(Math.floor(a.startMs/1000)%60).padStart(2,'0')}`;
  if(a.kind==='image')return `Image ${a.image || source.page}`;
  if(a.kind==='archive-manifest')return 'Archive manifest';
  return `Page ${source.page}`;
}
let db,hasTiming=false;
const parse = row => row ? JSON.parse(row.payload) : null;
function savedTiming(job) {
  const timing=hasTiming ? db.prepare('SELECT elapsed_ms AS elapsedMs,recorded_at AS recordedAt FROM scan_timing WHERE document_id=? AND job_id=?').get(job.documentId,job.id):null;
  return {elapsedMs:Math.max(0,job.elapsedMs || 0,timing?.elapsedMs || 0),recordedAt:timing?.recordedAt || job.timingRecordedAt || null};
}
function recoveredScan(job) {
  if(!job || !['queued','running'].includes(job.state))return job;
  const timing=savedTiming(job),approximate=job.state==='running';
  return {...job,state:'interrupted',startedAt:null,elapsedMs:timing.elapsedMs,timingRecordedAt:timing.recordedAt,
    timingApproximate:job.timingApproximate || approximate,
    error:`The app stopped before this scan finished. Resume when ready.${approximate ? ' Processing time excludes app downtime and may omit activity after the last saved timing update.':''}`};
}
function writeScan(job) {
  db.prepare('INSERT INTO scans VALUES(?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET state=excluded.state,position=excluded.position,payload=excluded.payload').run(job.documentId,job.state,job.position,JSON.stringify(job));
  db.prepare('INSERT INTO scan_timing VALUES(?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET job_id=excluded.job_id,elapsed_ms=excluded.elapsed_ms,recorded_at=excluded.recorded_at').run(job.documentId,job.id,Math.max(0,job.elapsedMs || 0),job.timingRecordedAt || stamp());
}
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function requireWrite() { if (!writable) throw new Error('This case is read-only.'); }
function legacy() {
  const folder = safePath(root, '.strategist/documents');
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter(id => ID.test(id)).map(id => {
    const record = readJson(root, `.strategist/documents/${id}/document.json`);
    if (record.id !== id) throw new Error('A legacy document identifier needs recovery.');
    const original = readLocal(root, record.original);
    if (hash(original) !== id) throw new Error(`Original checksum mismatch for ${record.reference || record.name}. Migration stopped; originals were not changed.`);
    const json = name => existsSync(safePath(root, `.strategist/documents/${id}/${name}.json`)) ? readJson(root, `.strategist/documents/${id}/${name}.json`) : null;
    return { record, pages: json('pages'), draft: json('draft') };
  });
}
function indexDocument(id) {
  const record = parse(db.prepare('SELECT payload FROM documents WHERE id=?').get(id));
  if (!record) return;
  db.prepare('DELETE FROM file_search WHERE document_id=?').run(id);
  const insert = db.prepare('INSERT INTO file_search(document_id,report_id,locator,anchor,text) VALUES(?,?,?,?,?)');
  db.prepare('DELETE FROM file_search_records WHERE document_id=?').run(id);
  const insertRecord=db.prepare('INSERT INTO file_search_records(document_id,report_id,text) VALUES(?,?,?)');
  insert.run(id, '', 'File details', '{}', `${record.reference || ''} ${record.name}`);
  const extraction = parse(db.prepare('SELECT payload FROM extractions WHERE document_id=?').get(id));
  for (const p of extraction?.pages || []) insert.run(id, '', sourceLabel(p), JSON.stringify(sourceAnchor(p)), p.text || '');
  insertRecord.run(id,'',`${record.reference || ''}\n${record.name}\n${(extraction?.pages || []).map(p=>p.text || '').join('\n')}`);
  for (const row of db.prepare('SELECT id,payload FROM reports WHERE document_id=? ORDER BY created_at').all(id)) {
    const report = parse(row);
    insert.run(id, row.id, 'Scan summary', '{}', report.summary || '');
    for(const page of report.sourcePages || []) insert.run(id,row.id,sourceLabel(page),JSON.stringify(sourceAnchor(page)),page.text || '');
    for (const f of report.findings || []) insert.run(id, row.id, f.sources?.[0] ? sourceLabel(f.sources[0]):'Scan finding', JSON.stringify(f.sources?.[0] ? sourceAnchor(f.sources[0]):{}), `${f.title || ''}\n${f.detail || ''}\n${(f.sources || []).map(s=>s.quote || '').join('\n')}`);
    for (const law of report.laws || []) insert.run(id, row.id, 'Legal reference', '{}', `${law.title}\n${law.provision}\n${law.text}\n${law.relevance}`);
    insertRecord.run(id,row.id,`${record.reference || ''}\n${record.name}\n${report.summary || ''}\n${(report.sourcePages || []).map(p=>p.text || '').join('\n')}\n${(report.findings || []).map(f=>`${f.title || ''}\n${f.detail || ''}\n${(f.sources || []).map(s=>s.quote || '').join('\n')}`).join('\n')}\n${(report.laws || []).map(l=>`${l.title}\n${l.provision}\n${l.text}\n${l.relevance}`).join('\n')}`);
  }
  db.prepare("INSERT INTO metadata(key,value) VALUES('searchRevision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)").run();
}
async function initialize() {
  const file = safePath(root, '.case-forge/case.sqlite', writable);
  if (!existsSync(file) && !writable) return { legacy: legacy(), readOnly: true };
  for (const suffix of ['-wal','-shm','-journal']) safePath(root, `.case-forge/case.sqlite${suffix}`);
  db = new DatabaseSync(file, { readOnly: !writable });
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) throw new Error('This case was saved by a newer Case Forge version.');
  if (writable) {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    db.exec(`CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,reference TEXT UNIQUE,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS extractions(document_id TEXT PRIMARY KEY REFERENCES documents(id),payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scans(document_id TEXT PRIMARY KEY REFERENCES documents(id),state TEXT NOT NULL,position REAL NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scan_timing(document_id TEXT PRIMARY KEY REFERENCES documents(id),job_id TEXT NOT NULL,elapsed_ms INTEGER NOT NULL,recorded_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),created_at TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS reports_document ON reports(document_id,created_at);
      CREATE TABLE IF NOT EXISTS law_cache(key TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS file_search USING fts5(document_id UNINDEXED,report_id UNINDEXED,locator UNINDEXED,anchor UNINDEXED,text,tokenize='unicode61');
      CREATE VIRTUAL TABLE IF NOT EXISTS file_search_records USING fts5(document_id UNINDEXED,report_id UNINDEXED,text,tokenize='unicode61');
      PRAGMA user_version=1;`);
    if (!db.prepare("SELECT value FROM metadata WHERE key='legacyMigration'").get()) {
      const entries = legacy();
      const backupPath = `.case-forge/backups/migration-${Date.now()}-${randomUUID()}`;
      if (entries.length) {
        for (const {record,pages,draft} of entries) {
          writeJson(root, `${backupPath}/${record.id}/document.json`, record);
          if (pages) writeJson(root, `${backupPath}/${record.id}/pages.json`, pages);
          if (draft) writeJson(root, `${backupPath}/${record.id}/draft.json`, draft);
        }
        writeJson(root, `${backupPath}/manifest.json`, { version:1,createdAt:stamp(),documents:entries.map(({record})=>({id:record.id,reference:record.reference,original:record.original})) });
      }
      transaction(() => {
        for (const {record,pages,draft} of entries) {
          db.prepare('INSERT INTO documents(id,reference,payload) VALUES(?,?,?)').run(record.id,record.reference || null,JSON.stringify(record));
          if (pages) db.prepare('INSERT INTO extractions VALUES(?,?)').run(record.id,JSON.stringify({version:1,pages,images:[],attachments:[],coverage:{complete:pages.length > 0 && pages.every(p=>Boolean(p.text?.trim())),warnings:[]},reader:{name:'legacy'}}));
          if (draft) {
            const report = {...draft,id:randomUUID(),documentId:record.id,legacy:true,summary:draft.summary || 'Legacy analysis; not a completed Files & AI scan.',createdAt:draft.createdAt || stamp()};
            db.prepare('INSERT INTO reports VALUES(?,?,?,?)').run(report.id,record.id,report.createdAt,JSON.stringify(report));
          }
          indexDocument(record.id);
        }
        if (db.prepare('SELECT count(*) AS count FROM documents').get().count < entries.length) throw new Error('Migration count verification failed.');
        db.prepare('INSERT INTO metadata VALUES(?,?)').run('legacyMigration',JSON.stringify({version:1,count:entries.length,at:stamp(),backupPath:entries.length ? backupPath : null}));
        db.prepare('INSERT OR IGNORE INTO metadata VALUES(?,?)').run('caseId',randomUUID());
      });
    }
    if(db.prepare("SELECT value FROM metadata WHERE key='recordSearchVersion'").get()?.value!=='2') {
      transaction(()=>{
        for(const {id} of db.prepare('SELECT id FROM documents').all())indexDocument(id);
        db.prepare("INSERT INTO metadata VALUES('recordSearchVersion','2') ON CONFLICT(key) DO UPDATE SET value='2'").run();
      });
    }
    hasTiming=true;
    // A process restart must never silently repeat requests or count downtime.
    for (const row of db.prepare("SELECT payload FROM scans WHERE state IN ('queued','running')").all()) {
      const job = recoveredScan(parse(row));
      db.prepare('UPDATE scans SET state=?,payload=? WHERE document_id=?').run(job.state,JSON.stringify(job),job.documentId);
    }
  }
  hasTiming=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scan_timing'").get());
  return {readOnly:!writable};
}
const operations = {
  snapshot() { return {documents:db.prepare('SELECT payload FROM documents').all().map(parse), scans:db.prepare("SELECT json_remove(payload,'$.checkpoint') AS payload FROM scans ORDER BY position").all().map(row=>writable ? parse(row):recoveredScan(parse(row))), reports:db.prepare("SELECT id,document_id AS documentId,created_at AS createdAt,json_extract(payload,'$.version') AS version,json_extract(payload,'$.schemaVersion') AS schemaVersion,COALESCE(json_extract(payload,'$.legacy'),0) AS legacy FROM reports ORDER BY created_at DESC,id DESC").all(),settings:parseSetting('jurisdiction'),caseId:db.prepare("SELECT value FROM metadata WHERE key='caseId'").get()?.value}; },
  getScan({id}) {const job=parse(db.prepare('SELECT payload FROM scans WHERE document_id=?').get(id));return writable ? job:recoveredScan(job);},
  document({record}) { requireWrite(); transaction(()=>{ db.prepare('INSERT INTO documents VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET reference=excluded.reference,payload=excluded.payload').run(record.id,record.reference || null,JSON.stringify(record)); indexDocument(record.id); }); return record; },
  extraction({id,value}) { if (value === undefined) return parse(db.prepare('SELECT payload FROM extractions WHERE document_id=?').get(id)); requireWrite(); transaction(()=>{ db.prepare('INSERT INTO extractions VALUES(?,?) ON CONFLICT(document_id) DO UPDATE SET payload=excluded.payload').run(id,JSON.stringify(value)); indexDocument(id); }); return value; },
  scan({job}) { requireWrite(); transaction(()=>writeScan(job)); return job; },
  timing({id,jobId,elapsedMs,recordedAt}) {requireWrite();if(!Number.isFinite(elapsedMs)||elapsedMs<0)throw new Error('Invalid processing duration.');return db.prepare("UPDATE scan_timing SET elapsed_ms=MAX(elapsed_ms,?),recorded_at=? WHERE document_id=? AND job_id=? AND EXISTS(SELECT 1 FROM scans WHERE scans.document_id=scan_timing.document_id AND state='running')").run(Math.floor(elapsedMs),recordedAt,id,jobId).changes;},
  report({id,report,job}) { if (!report) return db.prepare('SELECT payload FROM reports WHERE document_id=? ORDER BY created_at DESC,id DESC').all(id).map(parse); requireWrite(); transaction(()=>{
    if(!report.legacy){const prior=db.prepare("SELECT count(*) AS count,MAX(CASE WHEN json_type(payload,'$.version')='integer' THEN json_extract(payload,'$.version') ELSE 0 END) AS latest FROM reports WHERE document_id=? AND COALESCE(json_extract(payload,'$.legacy'),0)=0").get(id);report.version=Math.max(prior.count,prior.latest || 0)+1;report.schemaVersion=1;}
    db.prepare('INSERT INTO reports VALUES(?,?,?,?)').run(report.id,id,report.createdAt,JSON.stringify(report)); writeScan(job); indexDocument(id);
  }); return report; },
  settings({value}) { if (value === undefined) return parseSetting('jurisdiction'); requireWrite(); db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('jurisdiction',JSON.stringify(value)); return value; },
  law({key,value}) { if (value === undefined) return parse(db.prepare('SELECT payload FROM law_cache WHERE key=?').get(key)); requireWrite(); db.prepare('INSERT INTO law_cache VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload').run(key,JSON.stringify(value)); return value; },
  search({query,limit=50}) {
    const tokens = String(query).slice(0,300).match(/[\p{L}\p{N}]+/gu) || [];
    if (!tokens.length) return [];
    return db.prepare("SELECT document_id AS documentId,report_id AS reportId,locator,anchor,snippet(file_search,4,'','',' … ',48) AS text FROM file_search WHERE file_search MATCH ? ORDER BY rank LIMIT ?").all(tokens.slice(0,24).map(t=>'"'+t+'"').join(' AND '), Math.max(1,Math.min(100,limit))).map(r=>({...r,anchor:JSON.parse(r.anchor)}));
  },
  searchDocuments({query,history=false,mode='all',limit=10000}) {
    const terms=[...String(query).matchAll(/"([^"]+)"|(\S+)/g)].map(m=>m[1] || m[2]).filter(Boolean).slice(0,24);
    const phrase=terms.map(t=>'"'+t.replaceAll('"','""')+'"').join(mode==='any' ? ' OR ':' AND ');
    const revision=db.prepare("SELECT value FROM metadata WHERE key='searchRevision'").get()?.value || '0';
    const stats={reports:db.prepare('SELECT count(*) AS count FROM reports').get().count,currentReports:db.prepare('SELECT count(DISTINCT document_id) AS count FROM reports').get().count,unreadDocuments:db.prepare('SELECT count(*) AS count FROM documents LEFT JOIN extractions ON extractions.document_id=documents.id WHERE extractions.document_id IS NULL').get().count};
    if(!phrase)return {rows:[],total:0,revision,stats};
    // One FTS row per document/report keeps All words meaningful across pages.
    const condition=`file_search_records MATCH ? ${history ? '' : "AND (report_id='' OR report_id=(SELECT id FROM reports WHERE document_id=file_search_records.document_id ORDER BY created_at DESC,id DESC LIMIT 1))"}`;
    const total=db.prepare(`SELECT count(*) AS count FROM file_search_records WHERE ${condition}`).get(phrase).count;
    const rows=db.prepare(`SELECT document_id AS documentId,report_id AS reportId,snippet(file_search_records,2,'','',' … ',48) AS text FROM file_search_records WHERE ${condition} ORDER BY rank LIMIT ?`).all(phrase,Math.max(1,Math.min(10000,limit)));
    const anyPhrase=terms.map(t=>'"'+t.replaceAll('"','""')+'"').join(' OR ');
    const location=db.prepare("SELECT locator,anchor,snippet(file_search,4,'','',' … ',64) AS text FROM file_search WHERE file_search MATCH ? AND document_id=? AND report_id=? ORDER BY rank LIMIT 1");
    for(const row of rows){const source=location.get(anyPhrase,row.documentId,row.reportId);if(source)Object.assign(row,{locator:source.locator,anchor:JSON.parse(source.anchor),sourceText:source.text});}
    return {rows,total,revision,stats};
  },
  async backup() {
    requireWrite();
    const prefix = `.case-forge/backups/case-${Date.now()}-${randomUUID()}`;
    const database = `${prefix}/case/.case-forge/case.sqlite`;
    await backup(db,safePath(root,database,true));
    const files = [];
    const add = (path,destination) => { copyFileSync(safePath(root,path),safePath(root,`${prefix}/case/${destination}`,true)); const bytes=readLocal(root,`${prefix}/case/${destination}`);files.push({path:destination,sha256:hash(bytes),bytes:bytes.length}); };
    const walk = dir => {
      for (const name of readdirSync(dir)) {
        const full=join(dir,name), rel=relative(root,full).replace(/\\/g,'/');
        if (rel === '.git' || rel === '.case-forge/backups' || /^\.case-forge\/case\.sqlite(?:-(wal|shm|journal))?$/.test(rel)) continue;
        const stat=lstatSync(full);
        if (stat.isSymbolicLink()) throw new Error('Case backup cannot include linked files.');
        if (stat.isDirectory()) walk(full); else if(stat.isFile()) add(rel,rel);
      }
    };
    walk(root);
    const bytes=readLocal(root,database); files.push({path:'.case-forge/case.sqlite',sha256:hash(bytes),bytes:bytes.length});
    const manifest={version:1,createdAt:stamp(),files};
    writeJson(root,`${prefix}/manifest.json`,manifest);
    return {path:prefix,manifest};
  },
  close() { db?.close(); db=null; return true; }
};
function parseSetting(key) { const row=db.prepare('SELECT value FROM metadata WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; }
let tail=initialize().then(result=>{ parentPort.postMessage({ready:true,result}); }).catch(error=>{ parentPort.postMessage({ready:true,error:error.message}); });
parentPort.on('message',({id,method,args})=>{ tail=tail.then(async()=>{
  try { if(!operations[method]) throw new Error('Unknown database operation.'); const result=await operations[method](args || {}); parentPort.postMessage({id,result}); }
  catch(error) { parentPort.postMessage({id,error:error.message,code:error.code}); }
}); });
