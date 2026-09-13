import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,copyFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSeo,pages,siteBase,repository} from '../build-seo.mjs';
const source=fileURLToPath(new URL('../../website/',import.meta.url));
function fixture(t){const directory=mkdtempSync(join(tmpdir(),'case-forge-seo-'));for(const p of pages)copyFileSync(join(source,p.file),join(directory,p.file));t.after(()=>rmSync(directory,{recursive:true,force:true}));return directory;}
test('public build preserves a deployment subpath across canonical, schema, social and sitemap URLs',t=>{
 const directory=fixture(t),base='https://example.test/case-forge/';
 assert.deepEqual(buildSeo({directory,siteURL:base}),{public:true,base,pages:7});
 const sitemap=readFileSync(join(directory,'sitemap.xml'),'utf8');
 assert.equal((sitemap.match(/<loc>/g)||[]).length,7);assert.doesNotMatch(sitemap,/localhost|style-guide|404|api\//);
 for(const p of pages){const html=readFileSync(join(directory,p.file),'utf8');assert.equal((html.match(/<title>/g)||[]).length,1);assert.match(html,new RegExp(`<meta name="robots" content="${p.noindex?'noindex':'index'}`));const canonical=html.match(/rel="canonical" href="([^"]+)"/)[1];assert.equal(canonical,new URL(p.path??p.file,base).href);assert.match(html,/og:image:width" content="1200/);const schema=JSON.parse(html.match(/application\/ld\+json">(.*?)<\/script>/s)[1]);assert.equal(schema['@graph'][0].name,'Case Forge');assert.equal(schema['@graph'][1].url,base);if(p.article)assert.ok(schema['@graph'].some(item=>item['@type']==='BreadcrumbList'));}
 assert.match(readFileSync(join(directory,'robots.txt'),'utf8'),/Sitemap: https:\/\/example.test\/case-forge\/sitemap.xml/);
 const first=readFileSync(join(directory,'index.html'),'utf8');buildSeo({directory,siteURL:base});assert.equal(readFileSync(join(directory,'index.html'),'utf8'),first);
});
test('unconfigured builds cannot advertise indexing or stale public canonicals',t=>{
 const directory=fixture(t);buildSeo({directory,siteURL:'https://example.test/'});buildSeo({directory,siteURL:''});
 for(const p of pages){const html=readFileSync(join(directory,p.file),'utf8');assert.match(html,/name="robots" content="noindex, follow"/);assert.doesNotMatch(html,/rel="canonical"|property="og:url"/);}
 assert.doesNotMatch(readFileSync(join(directory,'sitemap.xml'),'utf8'),/<loc>/);assert.match(readFileSync(join(directory,'robots.txt'),'utf8'),/Disallow: \//);
});
test('public base rejects localhost and ambiguous URLs; verification values are escaped',t=>{
 for(const value of ['http://example.test','https://localhost','https://127.0.0.1','https://dev.local','https://user:pass@example.test','https://example.test/?x=1','https://example.test/#x'])assert.throws(()=>siteBase(value));
 const directory=fixture(t);buildSeo({directory,siteURL:'https://example.test',googleVerification:'token"<script>'});const html=readFileSync(join(directory,'index.html'),'utf8');assert.match(html,/content="token&quot;&lt;script&gt;"/);
});
test('public HTML links and assets resolve locally and published content avoids the wrong repository',()=>{
 for(const p of pages){const html=readFileSync(join(source,p.file),'utf8');assert.doesNotMatch(html,/github\.com\/kylescottfischer\/family-court-strategist/);for(const match of html.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)){const path=match[1].split(/[?#]/)[0];if(/^(?:https?:|data:|mailto:)/.test(path)||!path)continue;assert.ok(existsSync(join(source,path)),`${p.file}: missing ${path}`);}}
});
test('preloaded fonts are the fonts actually used, and responsive image variants exist',()=>{
 const home=readFileSync(join(source,'index.html'),'utf8'),tokens=readFileSync(join(source,'brand/tokens.css'),'utf8');
 assert.doesNotMatch(tokens,/\.ttf/);
 for(const match of home.matchAll(/rel="preload" href="brand\/fonts\/([^"]+)"/g)){assert.ok(tokens.includes(match[1]));assert.ok(existsSync(join(source,'brand/fonts',match[1])));}
 for(const state of ['overview','review'])for(const device of ['desktop','phone'])for(const size of ['','-small'])assert.ok(existsSync(join(source,`media/${device}-${state}${size}.webp`)));
 const png=readFileSync(join(source,'media/case-forge-social.png'));assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);
});
test('public project links use the organisation while the creator credit remains',t=>{
 const directory=fixture(t);buildSeo({directory,siteURL:'https://example.test/'});
 assert.equal(repository,'https://github.com/CaseForgeHq/family-court-strategist');
 for(const p of pages)assert.doesNotMatch(readFileSync(join(directory,p.file),'utf8'),/github\.com\/(?:odin33g|kylescottfischer)(?:\/|["#?\s]|$)/i);
 const about=readFileSync(join(directory,'about.html'),'utf8');assert.match(about,/Created by Kyle Fischer/);assert.match(about,/CaseForgeHq\/family-court-strategist\/blob\/main\/LICENSE/);
 assert.match(readFileSync(join(directory,'llms.txt'),'utf8'),/github\.com\/CaseForgeHq\/family-court-strategist/);
});
