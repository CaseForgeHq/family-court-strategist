import {validateSignup,CONSENT} from '../services/waitlist/validation.mjs';

const headers={
 'content-type':'application/json; charset=utf-8',
 'cache-control':'no-store',
 'x-robots-tag':'noindex, nofollow',
 'x-content-type-options':'nosniff',
 'referrer-policy':'same-origin',
};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers});
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/site-config.js'){
   if(!['GET','HEAD'].includes(request.method))return json(405,{error:'Method not allowed.'});
   return new Response(request.method==='HEAD'?null:'window.CASE_FORGE_SITE={waitlistEndpoint:"/api/waitlist",localPreview:false};\n',{headers:{...headers,'content-type':'text/javascript; charset=utf-8'}});
  }
  if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
  if(url.pathname!=='/api/waitlist')return json(404,{error:'Not found.'});
  if(request.method!=='POST')return json(405,{error:'Method not allowed.'});
  if(request.headers.get('origin')!==env.PUBLIC_ORIGIN)return json(403,{error:'Refresh the page and try again.'});
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json(415,{error:'Use the signup form.'});
  try {
   // Cloudflare supplies this header; do not trust user-supplied forwarding chains.
   const key='case-forge-waitlist:'+ (request.headers.get('CF-Connecting-IP')||'unknown');
   if(!(await env.WAITLIST_RATE_LIMIT.limit({key})).success)return json(429,{error:'Too many attempts. Please wait a minute and try again.'});
   if(Number(request.headers.get('content-length'))>4096)return json(413,{error:'The form is too large.'});
   const reader=request.body?.getReader();let size=0;const chunks=[];
   if(!reader)return json(400,{error:'Check the form and try again.'});
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();return json(413,{error:'The form is too large.'});}chunks.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{return json(400,{error:'Check the form and try again.'});}
   const parsed=validateSignup(data);if(parsed.error)return json(400,{error:parsed.error});
   await env.DB.prepare('INSERT INTO waitlist(email,name,platform,consent_version,created_at) VALUES(?,?,?,?,?) ON CONFLICT(email) DO NOTHING').bind(parsed.email,parsed.name,parsed.platform,CONSENT,new Date().toISOString()).run();
   return json(200,{message:'You’re on the list. We’ll contact you when the desktop app is ready to try.'});
  }catch{
   // Do not log request bodies, addresses or database exceptions containing signup data.
   return json(503,{error:'We couldn’t save your signup. Please try again.'});
  }
 }
};
