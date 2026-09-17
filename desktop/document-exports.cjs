const { BrowserWindow, dialog } = require('electron');
const { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { join, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');
function createDocumentExports({ base, tempPath, getContext, getWindow }) {
  const pending = new Map(); let working = false;
  const context = input => { const c = getContext(); if (!c || input.caseKey !== c.caseKey) throw Error('The case changed. Reopen Document creator.'); return c; };
  async function history(input) {
    const c = context(input), { readJson } = await import(pathToFileURL(join(base,'app/lib/files.js')).href);
    try { return { exports: readJson(c.root,'.case-forge/document-exports/history.json').exports || [] }; } catch(e) { if(e.code === 'ENOENT') return {exports:[]}; throw e; }
  }
  function discard(token) { const item=pending.get(token); if(!item)return; pending.delete(token);  }
  function close() { for(const token of pending.keys()) discard(token); }
  async function preview(input) {
    if(working)throw Error('A PDF is already being prepared.');
    const c=context(input); working=true; let render;
    try {
      close();
      const model=await import(pathToFileURL(join(base,'app/public/document-model.js')).href);
      const checks=model.checkDocument(input); if(checks.errors.length)throw Error(checks.errors.join(' '));
      render=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'document-export-render'}});
      render.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      await render.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(model.documentHTML(input)));
      const bytes=await render.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,pageSize:'A4',displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font:9px Arial;width:100%;text-align:center;color:#59665e"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
      const pdfjs=await import(pathToFileURL(join(base,'app/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
      const loading=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false});
      const pdf=await loading.promise;
      const { createCanvas } = require('node:module').createRequire(join(base,'app/package.json'))('@napi-rs/canvas');
      const images=[]; let actual='', pageCount=pdf.numPages;
      try {
        if(pageCount<1||pageCount>60)throw Error('Use a document with 1 to 60 pages.');
        for(let n=1;n<=pageCount;n++){
          const page=await pdf.getPage(n),content=await page.getTextContent();
          if(Math.abs(page.view[2]-595.28)>2||Math.abs(page.view[3]-841.89)>2)throw Error('PDF page size validation failed.');
          const items=content.items.filter(i=>typeof i.str==='string' && i.transform[5]>35);
          for(const i of items)if(i.str.trim()&&(i.transform[4]<45||i.transform[4]+i.width>page.view[2]-40||i.transform[5]>page.view[3]-30))throw Error('Some text is outside the safe page margins. Shorten or reformat the text.');
          actual+=items.map(i=>i.str).join('');
          const viewport=page.getViewport({scale:1.2}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
          await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
          images.push(canvas.toDataURL('image/png'));
        }
      }finally{await loading.destroy();}
      if(model.comparableText(actual)!==model.comparableText(model.documentText(input)))throw Error('PDF text verification failed. A character may not be supported. Please revise the text.');
      context(input);
      const token=randomUUID(),hash=createHash('sha256').update(bytes).digest('hex');
      pending.set(token,{bytes,hash,title:input.title.trim(),caseKey:c.caseKey,root:c.root,pages:pageCount,created:Date.now()});
      return {token,images,pages:pageCount,sha256:hash,warnings:checks.warnings,checks:['A4 page size','All source text preserved','Text inside page margins','Page numbers included']};
    }
    finally{render?.destroy();working=false;}
  }
  async function save(input) {
    const c=context(input), item=pending.get(input.token);
    if(!item||item.caseKey!==c.caseKey||item.root!==c.root||Date.now()-item.created>30*60*1000)throw Error('Preview this document again before exporting.');
    if(input.reviewed!==true)throw Error('Confirm you have reviewed the PDF first.');
    if(item.saving)throw Error('An export is already being saved.');item.saving=true;
    try {
      const answer=await dialog.showSaveDialog(getWindow(),{title:'Save reviewed PDF',defaultPath:item.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,100)+'.pdf',filters:[{name:'PDF document',extensions:['pdf']}]});
      if(answer.canceled)return {canceled:true};context(input);
      if(!pending.has(input.token))throw Error('The preview expired. Please create it again.');
      const {readJson,writeJson}=await import(pathToFileURL(join(base,'app/lib/files.js')).href);
      let log;try{log=readJson(c.root,'.case-forge/document-exports/history.json');}catch(e){if(e.code!=='ENOENT')throw e;log={exports:[]};}
      writeFileSync(answer.filePath,item.bytes);
      const entry={id:randomUUID(),title:item.title,file:basename(answer.filePath),pages:item.pages,sha256:item.hash,exportedAt:new Date().toISOString(),reviewed:true,qualityVersion:1};
      try{log.exports.unshift(entry);writeJson(c.root,'.case-forge/document-exports/history.json',{exports:log.exports.slice(0,500)});}catch{return {saved:true,file:answer.filePath,warning:'PDF saved, but the export history could not be updated.'};}
      discard(input.token);return {saved:true,file:answer.filePath,entry};
    }finally{item.saving=false;}
  }
  return {preview,save,history,close};
}
module.exports={createDocumentExports};
