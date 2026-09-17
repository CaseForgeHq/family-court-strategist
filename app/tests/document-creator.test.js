import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {checkDocument,documentHTML} from '../public/document-model.js';
import {createDocumentCreator} from '../public/document-creator.js';
test('PDF uses section order and validates all section content',()=>{
 const input={title:'Title',body:'Intro\n\nEnd',sections:[{id:'h',type:'header',text:'Intro'},{id:'f',type:'footer',text:'End'},{id:'t',type:'title',text:'Title'}]};
 const html=documentHTML(input);assert.ok(html.indexOf('<p>Intro')<html.indexOf('<p>End'));assert.ok(html.indexOf('<p>End')<html.indexOf('<h1>Title'));
 input.sections[0].text='[recipient name]';assert.ok(checkDocument(input).errors.length);
});
test('builder moves and adds sections, persists order, and invalidates the inline PDF',async t=>{
 const dom=new JSDOM('<main></main>',{url:'http://localhost'}),old=globalThis.window;globalThis.window=dom.window;
 const host=dom.window.document.querySelector('main');let stored,received;
 const tool=createDocumentCreator({getSession:()=>({caseKey:'case',access:{canWrite:true}}),api:async(_p,o)=>o?(stored=structuredClone(o.body),{...stored,revision:1,savedAt:new Date().toISOString()}):{pages:stored?[{...stored,revision:1}]:[]},desktop:()=>({previewDocument:async input=>(received=input,{token:'verified',pages:1,images:['data:image/png;base64,AA==']}),documentHistory:async()=>({exports:[]})})});
 t.after(()=>{tool.unmount();dom.window.close();globalThis.window=old;});
 await tool.mount(host,{title:'Title',body:'Body'});
 host.querySelector('[data-section="body"] [data-move="-1"]').click();
 assert.deepEqual([...host.querySelectorAll('.document-block')].map(el=>el.textContent),['Header','Body','Title','Footer']);
 host.querySelector('#document-add-section').click();
 const added=host.querySelector('#document-sections').lastElementChild.querySelector('textarea');added.value='Extra section';added.dispatchEvent(new dom.window.Event('input'));
 await tool.saveDraft();assert.equal(stored.sections.at(-1).text,'Extra section');assert.equal(stored.sections[1].type,'text');
 host.querySelector('#document-preview').click();await new Promise(r=>setTimeout(r,0));
 assert.equal(received.sections[1].text,'Body');assert.equal(host.querySelectorAll('#document-canvas img').length,1);
 host.querySelector('#document-reviewed').checked=true;host.querySelector('#document-reviewed').dispatchEvent(new dom.window.Event('change'));
 host.querySelector('[data-section="body"] [data-move="1"]').click();
 assert.ok(host.querySelector('#document-save-pdf').disabled);assert.equal(host.querySelectorAll('#document-canvas img').length,0);
});
test('document quality blocks empty text and unfinished templates, and escapes user content',()=>{
 assert.ok(checkDocument({title:'',body:''}).errors.length);
 assert.ok(checkDocument({title:'Letter',body:'Dear [name]'}).errors.length);
 const html=documentHTML({title:'<script>x</script>',body:'<img src="https://example.com/secret"> & text'});
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);
});
test('PDF export requires a preview and review, edits invalidate both, draft persists across views',async t=>{
 const dom=new JSDOM('<main></main>',{url:'http://localhost'}),old=globalThis.window;globalThis.window=dom.window;
 const host=dom.window.document.querySelector('main');let exports=0;const saved=[];
 const tool=createDocumentCreator({getSession:()=>({caseKey:'case',access:{canWrite:true}}),api:async(path,options)=>options?(saved.push(options.body),{...options.body,revision:1,savedAt:new Date().toISOString()}):{pages:[]},desktop:()=>({previewDocument:async()=>({token:'verified',pages:2,images:['data:image/png;base64,AA==','data:image/png;base64,AA==']}),saveDocumentPDF:async()=>{exports++;return {saved:true,file:'test.pdf'};},documentHistory:async()=>({exports:[]})})});
 t.after(()=>{tool.unmount();dom.window.close();globalThis.window=old;});
 await tool.mount(host,{title:'Meeting notes',body:'Reviewed fictional notes.'});
 assert.ok(host.querySelector('#document-save-pdf').disabled);
 host.querySelector('#document-preview').click();await new Promise(r=>setTimeout(r,0));
 assert.ok(host.querySelector('#document-save-pdf').disabled);
 const check=host.querySelector('#document-reviewed');check.checked=true;check.dispatchEvent(new dom.window.Event('change'));
 assert.equal(host.querySelector('#document-save-pdf').disabled,false);
 const body=host.querySelector('#document-body');body.value='Changed fictional notes.';body.dispatchEvent(new dom.window.Event('input'));
 assert.ok(host.querySelector('#document-save-pdf').disabled);assert.equal(check.checked,false);assert.equal(exports,0);
 tool.unmount();await tool.saveDraft();assert.equal(saved[0].body,'Changed fictional notes.');
 await tool.mount(host);assert.equal(host.querySelector('#document-body').value,'Changed fictional notes.');
});
