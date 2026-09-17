import { Worker } from 'node:worker_threads';
import { existsSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { safePath, readJson, readLocal, caseRoot } from './files.js';
import { AppError } from './errors.js';

export class CaseDatabase {
  constructor(root,{writable=true}={}) {
    this.root=root; this.pending=new Map(); this.sequence=0; this.closed=false;
    this.worker=new Worker(new URL('./case-database-worker.js',import.meta.url),{workerData:{root,writable}});
    this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});
    this.worker.on('message',message=>{
      const error=message.error ? new AppError(message.error,409) : null;
      if(message.ready) { if(error)this.rejectReady(error);else this.resolveReady(message.result);return; }
      const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);
      if(error)pending.reject(error);else pending.resolve(message.result);
    });
    this.worker.on('error',error=>{this.rejectReady(error);for(const p of this.pending.values())p.reject(error);this.pending.clear();});
    this.worker.on('exit',()=>{ if(!this.closed) {const error=new Error('Case database worker stopped.');this.rejectReady(error);for(const p of this.pending.values())p.reject(error);this.pending.clear();} });
  }
  async call(method,args={}) { await this.ready;if(this.closed)throw new Error('Case database is closed.');const id=++this.sequence;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({id,method,args});}); }
  async close() { if(this.closed)return;try {await this.call('close');}finally{this.closed=true;await this.worker.terminate();} }
}

// Restore into an explicitly selected empty local folder. Verify the entire
// manifest before creating destination files; never overwrite a case.
export function restoreCaseBackup(backupFolder,destination) {
  const source=caseRoot(backupFolder), target=caseRoot(destination);
  if(readdirSync(target).length)throw new AppError('Choose an empty folder for the restored case.',409);
  const manifest=readJson(source,'manifest.json');
  if(manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.some(f=>f.path === '.case-forge/case.sqlite'))throw new AppError('This backup manifest is not supported.');
  const seen=new Set();
  for(const file of manifest.files) {
    if(typeof file.path !== 'string' || seen.has(file.path))throw new AppError('Invalid backup manifest.');seen.add(file.path);
    safePath(target,file.path);const bytes=readLocal(source,`case/${file.path}`);
    if(bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256)throw new AppError(`Backup checksum mismatch: ${file.path}`,409);
  }
  for(const file of manifest.files)copyFileSync(safePath(source,`case/${file.path}`),safePath(target,file.path,true));
  return {root:target,files:manifest.files.length};
}
