import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';

export const repository='https://github.com/CaseForgeHq/family-court-strategist';
const socialSource=new URL('../website/media/case-forge-social.png',import.meta.url);
const socialImage=readFileSync(socialSource);
const socialVersion=createHash('sha256').update(socialImage).digest('hex').slice(0,12);
const socialPath=`media/case-forge-social-${socialVersion}.png`;
export const pages=[
 {file:'index.html',path:'',title:'Case Forge | Family Court Document & Evidence Organiser',description:'Organise family court documents, build a source-linked timeline and review AI findings. Download the free Case Forge toolkit or join the desktop app waitlist.'},
 {file:'guides.html',title:'Document Organisation & Case Preparation Guides | Case Forge',description:'Practical guides to organising family court documents, building a case timeline and checking AI document review. Start with records and sources you can verify.'},
 {file:'organise-family-court-documents.html',title:'How to Organise Family Court Documents | Case Forge',description:'A practical filing workflow: preserve original documents, assign source references, build a document index and keep working notes separate from the record.',article:true},
 {file:'build-case-timeline.html',title:'How to Build a Case Timeline with Sources | Case Forge',description:'Build a source-linked case chronology. Separate event and document dates, record uncertainty and use a fictional example to check your timeline.',article:true},
 {file:'ai-document-review.html',title:'How to Check AI Document Review | Case Forge',description:'Check AI summaries against original documents, review source quotations and understand local storage versus cloud processing before sharing case material.',article:true},
 {file:'about.html',title:'About Case Forge | Free Toolkit & Desktop App Plans',description:'What Case Forge does, what the free open-source toolkit includes, and what is still in development for the local desktop app.'},
 {file:'privacy.html',title:'Waitlist Privacy | Case Forge',description:'What the Case Forge desktop waitlist collects, how signup details are used, and why case documents do not belong in the signup form.'},
 {file:'style-guide.html',title:'Brand Guidelines | Case Forge',description:'The Case Forge visual identity and interface components.',noindex:true},
 {file:'404.html',title:'Page Not Found | Case Forge',description:'Find the Case Forge free toolkit and preparation guides.',noindex:true},
];
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function siteBase(value){
 if(!value)return null;
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.hostname.includes('.')||/^(localhost|127\.|0\.)/.test(url.hostname)||url.hostname.endsWith('.local'))throw new Error('SITE_URL must be a public HTTPS website URL, with no credentials, query or fragment. Include its project path if needed.');
 url.pathname=url.pathname.replace(/\/+$/,'')+'/';return url;
}
export function buildSeo({directory=fileURLToPath(new URL('../website/',import.meta.url)),siteURL=process.env.SITE_URL,googleVerification=process.env.GOOGLE_SITE_VERIFICATION,bingVerification=process.env.BING_SITE_VERIFICATION}={}){
 const base=siteBase(siteURL),url=path=>new URL(path,base).href;
 mkdirSync(join(directory,'media'),{recursive:true});
 writeFileSync(join(directory,socialPath),socialImage);
 for(const page of pages){
  const indexable=!!base&&!page.noindex,canonical=base?url(page.path??page.file):null;
  const head=[`<title>${escape(page.title)}</title>`,`<meta name="description" content="${escape(page.description)}">`,`<meta name="robots" content="${indexable?'index, follow, max-image-preview:large':'noindex, follow'}">`,`<meta name="theme-color" content="#F8F4EC">`,`<meta property="og:site_name" content="Case Forge">`,`<meta property="og:locale" content="en_AU">`,`<meta property="og:type" content="${page.article?'article':'website'}">`,`<meta property="og:title" content="${escape(page.title)}">`,`<meta property="og:description" content="${escape(page.description)}">`,`<meta name="twitter:card" content="summary_large_image">`,`<meta name="twitter:title" content="${escape(page.title)}">`,`<meta name="twitter:description" content="${escape(page.description)}">`];
  if(canonical){
   head.push(`<link rel="canonical" href="${escape(canonical)}">`,`<meta property="og:url" content="${escape(canonical)}">`,`<meta property="og:image" content="${escape(url(socialPath))}">`,`<meta property="og:image:secure_url" content="${escape(url(socialPath))}">`,`<meta property="og:image:type" content="image/png">`,`<meta property="og:image:width" content="1200">`,`<meta property="og:image:height" content="630">`,`<meta property="og:image:alt" content="Case Forge logo and brand symbol. Organise your records. Build a clearer picture.">`,`<meta name="twitter:image" content="${escape(url(socialPath))}">`,`<meta name="twitter:image:alt" content="Case Forge logo and brand symbol. Organise your records. Build a clearer picture.">`);
   const org={'@type':'Organization','@id':url('#organisation'),name:'Case Forge',email:'caseforgehq@proton.me',url:url(''),logo:url('brand/logo.svg'),sameAs:[repository]};
   const site={'@type':'WebSite','@id':url('#website'),name:'Case Forge',url:url(''),publisher:{'@id':org['@id']},inLanguage:'en-AU'};
   const webPage={'@type':'WebPage','@id':canonical+'#page',url:canonical,name:page.title,description:page.description,isPartOf:{'@id':site['@id']},inLanguage:'en-AU'};
   const graph=[org,site,webPage];
   if(page.article){
    const article={'@type':'Article',headline:page.title.replace(/ \| Case Forge$/,''),description:page.description,mainEntityOfPage:{'@id':webPage['@id']},author:{'@id':org['@id']},publisher:{'@id':org['@id']},datePublished:'2026-09-13',dateModified:'2026-09-13',image:url(socialPath)};
    const crumbs={'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'Home',item:url('')},{'@type':'ListItem',position:2,name:'Guides',item:url('guides.html')},{'@type':'ListItem',position:3,name:article.headline,item:canonical}]};
    graph.push(article,crumbs);
   }
   if(page.file==='index.html')graph.push({'@type':'SoftwareSourceCode',name:'Case Forge free toolkit',description:'Open-source case folder templates and AI guidance. The paid desktop app is in development.',codeRepository:repository,license:repository+'/blob/main/LICENSE',programmingLanguage:['Markdown','JavaScript'],url:url('#get-started'),isAccessibleForFree:true});
   head.push(`<script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@graph':graph}).replace(/</g,'\\u003c')}</script>`);
  }
  if(page.file==='index.html'){
   if(googleVerification)head.push(`<meta name="google-site-verification" content="${escape(googleVerification)}">`);
   if(bingVerification)head.push(`<meta name="msvalidate.01" content="${escape(bingVerification)}">`);
   head.push('<link rel="preload" href="brand/fonts/Inter-Latin.woff2" as="font" type="font/woff2" crossorigin>','<link rel="preload" href="brand/fonts/EBGaramond-Latin.woff2" as="font" type="font/woff2" crossorigin>');
  }
  let html=readFileSync(join(directory,page.file),'utf8').replace(/<!-- SEO:START -->[\s\S]*?<!-- SEO:END -->\s*/g,'').replace(/<title>[\s\S]*?<\/title>\s*/gi,'').replace(/<meta\s+name=["'](?:description|robots)["'][^>]*>\s*/gi,'');
  // A 404 may be served at any depth. Absolute resource/navigation URLs keep it usable.
  if(page.file==='404.html')html=html.replace(/href="(?:https:\/\/[^"\s]+\/)?(brand\/[^"\s]+|styles\.css|guides\.html)"/g,(_,path)=>`href="${escape(base?url(path):path)}"`).replace(/href="[^"]*">Case Forge home/,`href="${escape(base?url(''):'./')}">Case Forge home`);
  html=html.replace('</head>',`<!-- SEO:START -->\n${head.join('\n')}\n<!-- SEO:END -->\n</head>`);
  writeFileSync(join(directory,page.file),html);
 }
 const indexed=pages.filter(p=>!p.noindex);
 writeFileSync(join(directory,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${base?indexed.map(p=>`  <url><loc>${escape(url(p.path??p.file))}</loc>${p.article?'<lastmod>2026-09-13</lastmod>':''}</url>`).join('\n'):''}\n</urlset>\n`);
 writeFileSync(join(directory,'robots.txt'),base?`# Public marketing content only. Case files are never part of this website.\nUser-agent: *\nAllow: /\nDisallow: ${base.pathname}api/\nSitemap: ${url('sitemap.xml')}\n`:'# Local/unconfigured preview. Rebuild with SITE_URL before public launch.\nUser-agent: *\nDisallow: /\n');
 const link=path=>base?url(path):(path||'./');
 writeFileSync(join(directory,'llms.txt'),`# Case Forge\n\n> Free, open-source case organisation toolkit for parents in family court. Files live in a folder the user controls. A paid desktop app is in development; public installers, pricing and billing are not available yet.\n\n## Product and setup\n\n- [Website](${link('')}): Free toolkit download and desktop waitlist.\n- [Setup instructions](${link('setup.md')}): Folder-aware AI or manual installation, prerequisites and file-preservation rules.\n- [About and availability](${link('about.html')}): Product scope, source and limitations.\n- [Source repository](${repository}): MIT-licensed source code.\n\n## Practical guides\n\n${pages.filter(p=>p.article).map(p=>`- [${p.title.replace(/ \| Case Forge$/,'')}](${link(p.file)}): ${p.description}`).join('\n')}\n\n## Privacy and limits\n\n- [Waitlist privacy](${link('privacy.html')}): Signup details only; no case material.\n- Cloud AI processes material shared with the selected provider. Local storage does not mean cloud analysis stays on-device. AI output needs source checking.\n- Case Forge is not a law firm and does not provide legal representation or promise outcomes. Phone images are a responsive preview, not a released iPhone app.\n\nThis file is an optional public content index, not an instruction to AI systems or a guarantee of search inclusion.\n`);
 writeFileSync(join(directory,'.nojekyll'),'');
 return {public:!!base,base:base?.href??null,pages:indexed.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(buildSeo());
