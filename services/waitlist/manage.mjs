// Owner-only local administration. No public endpoint exposes signup records.
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const database=process.env.WAITLIST_DB||fileURLToPath(new URL('../../.local/waitlist.sqlite',import.meta.url));
const [action,value]=process.argv.slice(2);
if(!existsSync(database))throw new Error('No waitlist database found. Run the website first or set WAITLIST_DB.');
if(!['count','export','remove'].includes(action))throw new Error('Usage: node services/waitlist/manage.mjs count | export ./waitlist.csv | remove email@example.com');
const db=new DatabaseSync(database,{readOnly:action!=='remove'});
try{
 if(action==='count')console.log(`${db.prepare('SELECT count(*) AS n FROM waitlist').get().n} people on the desktop waitlist.`);
 if(action==='export'){
  if(!value)throw new Error('Choose a private output path for the CSV.');
  const out=resolve(value),publicFolder=fileURLToPath(new URL('../../website/',import.meta.url));
  if(out.startsWith(publicFolder))throw new Error('Do not export signup details into the public website folder.');
  const cell=v=>'"'+(/^[=+\-@\t\r]/.test(String(v))?"'":'')+String(v).replaceAll('"','""')+'"';
  const rows=db.prepare('SELECT name,email,platform,consent_version,created_at FROM waitlist ORDER BY id').all();
  writeFileSync(out,['name,email,platform,consent_version,created_at',...rows.map(row=>Object.values(row).map(cell).join(','))].join('\r\n')+'\r\n',{flag:'wx',mode:0o600});
  console.log(`${rows.length} signups exported. Keep this file private.`);
 }
 if(action==='remove'){
  if(!value)throw new Error('Provide the email address to remove.');
  const result=db.prepare('DELETE FROM waitlist WHERE email=?').run(value.trim().toLowerCase());
  console.log(`${result.changes} signup removed.`);
 }
}finally{db.close();}
