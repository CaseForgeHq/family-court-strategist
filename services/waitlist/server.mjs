import { createServer as httpServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.ttf':'font/ttf','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8','.json':'application/json; charset=utf-8','.tgz':'application/gzip','.zip':'application/zip'};
import {validateSignup,CONSENT} from './validation.mjs';
export function createWebsite({database=join(ROOT,'.local/waitlist.sqlite'),publicOrigin=null,allowedOrigins=[],website=join(ROOT,'website'),rateLimit=12}={}) {
 if (publicOrigin && new URL(publicOrigin).origin!==publicOrigin) throw new Error('PUBLIC_ORIGIN must be an exact origin without a trailing slash.');
 const origins=new Set([publicOrigin,...allowedOrigins].filter(Boolean));
 mkdirSync(dirname(database),{recursive:true,mode:0o700});
 const db=new DatabaseSync(database);chmodSync(database,0o600);
 db.exec('CREATE TABLE IF NOT EXISTS waitlist (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, platform TEXT NOT NULL, consent_version TEXT NOT NULL, created_at TEXT NOT NULL)');
 const insert=db.prepare('INSERT INTO waitlist(email,name,platform,consent_version,created_at) VALUES(?,?,?,?,?) ON CONFLICT(email) DO NOTHING');
 const buckets=new Map();
 function consume(key){const now=Date.now();for(const [k,v] of buckets){if(v.until<now)buckets.delete(k);}const b=buckets.get(key)||{count:0,until:now+60_000};b.count++;buckets.set(key,b);return b.count<=rateLimit;}
 const server=httpServer(async(req,res)=>{
  res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','same-origin');
  if(!publicOrigin)res.setHeader('x-robots-tag','noindex, nofollow');
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  const json=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-robots-tag':'noindex, nofollow'});res.end(req.method==='HEAD'?undefined:JSON.stringify(body));};
  try {
   const host=req.headers.host||'';
   if(!publicOrigin && !/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) return json(403,{error:'Invalid host.'});
   const origin=publicOrigin||`http://${host}`;
   const url=new URL(req.url,origin);
   if(url.pathname==='/api/waitlist') {
    const requestOrigin=req.headers.origin;
    const accepted=requestOrigin===origin || origins.has(requestOrigin);
    if(requestOrigin && accepted){res.setHeader('access-control-allow-origin',requestOrigin);res.setHeader('vary','Origin');}
    if(req.method==='OPTIONS'){
     if(!accepted)return json(403,{error:'This website is not allowed.'});
     res.writeHead(204,{'access-control-allow-methods':'POST','access-control-allow-headers':'content-type','access-control-max-age':'600'});return res.end();
    }
    if(req.method!=='POST')return json(405,{error:'Method not allowed.'});
    if(!accepted)return json(403,{error:'Refresh the page and try again.'});
    if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'Use the signup form.'});
    if(!consume(req.socket.remoteAddress))return json(429,{error:'Too many attempts. Please wait a minute and try again.'});
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>4096){json(413,{error:'The form is too large.'});req.resume();return;}chunks.push(chunk);}
    let data;try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(400,{error:'Check the form and try again.'});}
    const parsed=validateSignup(data);if(parsed.error)return json(400,{error:parsed.error});
    const {name,email,platform}=parsed;
    insert.run(email,name,platform,CONSENT,new Date().toISOString());
    // Identical responses prevent email enumeration. No email is sent by this service.
    return json(200,{message:'You’re on the list. We’ll contact you when the desktop app is ready to try.'});
   }
   if(!['GET','HEAD'].includes(req.method))return json(405,{error:'Method not allowed.'});
   if(url.pathname==='/index.html'){res.writeHead(308,{location:'/'+url.search,'cache-control':'no-cache'});return res.end();}
   if(url.pathname==='/site-config.js'){
    res.writeHead(200,{'content-type':MIME['.js'],'cache-control':'no-store'});
    return res.end(req.method==='HEAD'?'':`window.CASE_FORGE_SITE=${JSON.stringify({waitlistEndpoint:'/api/waitlist',localPreview:!publicOrigin})};`);
   }
   let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return json(400,{error:'Invalid path.'});}
   if(pathname.includes('\\')||pathname.split('/').some(p=>p.startsWith('.')))return json(404,{error:'Not found.'});
   const file=resolve(website,'.'+(pathname==='/'?'/index.html':pathname));
   if(!file.startsWith(resolve(website)+sep)||!MIME[extname(file)])return json(404,{error:'Not found.'});
   let stat;try{stat=statSync(file);}catch{return json(404,{error:'Not found.'});}
   if(!stat.isFile())return json(404,{error:'Not found.'});
   const extension=extname(file);
   if(['/style-guide.html','/404.html'].includes(pathname)||['.md','.txt','.zip','.tgz'].includes(extension))res.setHeader('x-robots-tag','noindex, follow');
   const compressible=/\.(html|css|js|svg|md|txt|xml|json)$/.test(file);
   const acceptsGzip=(req.headers['accept-encoding']||'').split(',').some(item=>{const [name,...params]=item.trim().split(';');return name.trim()==='gzip'&&!params.some(p=>/^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(p));});
   let body=readFileSync(file);
   if(compressible){res.setHeader('vary','Accept-Encoding');if(acceptsGzip){body=gzipSync(body);res.setHeader('content-encoding','gzip');}}
   const etag='"'+createHash('sha256').update(body).digest('hex').slice(0,24)+'"';
   res.setHeader('etag',etag);
   res.setHeader('cache-control',/\.(woff2|webp|png)$/.test(file)?'public, max-age=86400':'no-cache');
   if((req.headers['if-none-match']||'').split(',').some(value=>value.trim().replace(/^W\//,'')===etag||value.trim()==='*')){res.writeHead(304);return res.end();}
   res.writeHead(200,{'content-type':MIME[extension],'content-length':body.length});
   res.end(req.method==='HEAD'?undefined:body);
  }catch{if(!res.headersSent)json(500,{error:'We couldn’t save your signup. Please try again.'});else res.end();}
 });
 server.requestTimeout=15_000;server.headersTimeout=10_000;
 server.on('close',()=>db.close());
 return server;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||4321);const publicOrigin=process.env.PUBLIC_ORIGIN||null;
 const host=process.env.HOST||'127.0.0.1';
 if(!publicOrigin&&!['127.0.0.1','localhost','::1'].includes(host))throw new Error('Set PUBLIC_ORIGIN before exposing the website server.');
 const server=createWebsite({database:process.env.WAITLIST_DB||join(ROOT,'.local/waitlist.sqlite'),publicOrigin,allowedOrigins:(process.env.ALLOWED_ORIGINS||'').split(',').filter(Boolean)});
 server.listen(port,host,()=>console.log(`Case Forge website + waitlist: ${publicOrigin||`http://${host}:${port}`}\nWaitlist stored outside the public website folder.`));
}
