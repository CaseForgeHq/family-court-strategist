import {writeFileSync} from 'node:fs';
const endpoint=process.env.WAITLIST_API_URL||null;
if(endpoint){const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password)throw new Error('WAITLIST_API_URL must be a public HTTPS endpoint without credentials.');}
writeFileSync(new URL('../website/site-config.js',import.meta.url),`window.CASE_FORGE_SITE=${JSON.stringify({waitlistEndpoint:endpoint,localPreview:false})};\n`);
console.log(endpoint?'Configured public waitlist endpoint.':'Static preview: waitlist disabled until an endpoint is configured.');
