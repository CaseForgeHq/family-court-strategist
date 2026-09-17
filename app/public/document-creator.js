import { esc } from './file-register.js';
import { checkDocument, documentSections } from './document-model.js';
const templates = {
  general: { title: '', body: '' },
  letter: { title: 'Letter', body: '[date]\n\n[recipient name]\n[address]\n\nDear [name],\n\n[insert your message]\n\nYours sincerely,\n[name]' },
  meeting: { title: 'Meeting notes', body: 'Date: [date]\nAttendees: [names]\n\nPurpose\n[insert purpose]\n\nDiscussion\n[insert notes]\n\nActions and owners\n[insert actions]\n\nNext meeting\n[date]' }
};
export function createDocumentCreator({ api, getSession, desktop = () => window.strategistDesktop }) {
  let host, key, draft, dirty=false, preview=null, busy=false, pages=[], message='', generation=0;
  const fresh=()=>({id:window.crypto.randomUUID(),title:'',body:'',expectedRevision:0});
  let mode='edit', dragged=null, selectedTemplate='general';
  const expanded=new Map();
  const labels={header:'Header',title:'Document title',text:'Document text',footer:'Footer'};
  const signature=d=>JSON.stringify([d.title,d.body,d.sections]);
  const sync=()=>{draft.title=draft.sections.find(s=>s.type==='title').text;draft.body=draft.sections.filter(s=>s.type!=='title'&&s.text.trim()).map(s=>s.text).join('\n\n');};
  function invalidate(){preview=null;mode='edit';changed(true);find('#document-reviewed').checked=false;message='Changes need a fresh PDF preview.';renderPage();update();}

  const find=s=>host?.querySelector(s);
  const warn=e=>{if(dirty){e.preventDefault();e.returnValue='';}};
  const changed=value=>{dirty=value;window.removeEventListener('beforeunload',warn);if(dirty)window.addEventListener('beforeunload',warn);};
  function renderPage(){
    if(!host)return;
    find('#document-edit-view').setAttribute('aria-pressed',String(mode==='edit'));
    find('#document-pdf-view').setAttribute('aria-pressed',String(mode==='pdf'));
    find('#document-pdf-view').disabled=!preview;
    find('#document-canvas').innerHTML=mode==='pdf'&&preview?preview.images.map((src,i)=>`<figure><img src="${src}" alt="PDF page ${i+1} of ${preview.pages}"><figcaption>Page ${i+1} of ${preview.pages}</figcaption></figure>`).join(''):`<article class="document-sheet" aria-label="Document layout">${draft.sections.map(s=>`<div class="document-block block-${s.type}" data-page-section="${s.id}">${s.text.trim()?esc(s.text):`<span class="document-placeholder">${labels[s.type]}</span>`}</div>`).join('')}</article>`;
  }
  function renderSections(){
    const firstText=draft.sections.find(s=>s.type==='text')?.id;
    find('#document-sections').innerHTML=draft.sections.map((s,i)=>`<section class="document-section" data-section="${s.id}"><div class="document-section-heading" draggable="true" data-drag="${s.id}"><span aria-hidden="true">⠿</span><button type="button" class="section-toggle" data-toggle="${s.id}" aria-expanded="${expanded.get(s.id)??!['header','footer'].includes(s.type)}">${labels[s.type]}${s.type==='text'&&s.id!==firstText?' '+(i+1):''}</button><button type="button" class="section-move" data-move="-1" aria-label="Move ${labels[s.type]} up" ${i===0?'disabled':''}>↑</button><button type="button" class="section-move" data-move="1" aria-label="Move ${labels[s.type]} down" ${i===draft.sections.length-1?'disabled':''}>↓</button></div><textarea id="${s.type==='title'?'document-title':s.id===firstText?'document-body':'section-'+s.id}" aria-label="${labels[s.type]}" data-section-text="${s.id}" ${!(expanded.get(s.id)??!['header','footer'].includes(s.type))?'hidden':''} rows="${s.type==='text'?5:2}" maxlength="${s.type==='title'?140:60000}" spellcheck="true" placeholder="${labels[s.type]}">${esc(s.text)}</textarea></section>`).join('');
    find('#document-sections').querySelectorAll('[data-toggle]').forEach(el=>el.addEventListener('click',()=>{const open=el.getAttribute('aria-expanded')!=='true';expanded.set(el.dataset.toggle,open);el.setAttribute('aria-expanded',String(open));el.closest('[data-section]').querySelector('textarea').hidden=!open;}));
    find('#document-sections').querySelectorAll('[data-section-text]').forEach(el=>el.addEventListener('input',()=>{draft.sections.find(s=>s.id===el.dataset.sectionText).text=el.value;sync();invalidate();}));
    find('#document-sections').querySelectorAll('[data-move]').forEach(el=>el.addEventListener('click',()=>{const id=el.closest('[data-section]').dataset.section;const i=draft.sections.findIndex(s=>s.id===id);move(id,i+Number(el.dataset.move));find(`[data-section="${id}"] textarea`).focus();}));
    find('#document-sections').querySelectorAll('[data-drag]').forEach(el=>el.addEventListener('dragstart',e=>{dragged=el.dataset.drag;e.dataTransfer.setData('text/plain',dragged);e.dataTransfer.effectAllowed='move';}));
    find('#document-sections').querySelectorAll('[data-section]').forEach(el=>{el.addEventListener('dragover',e=>{if(dragged)e.preventDefault();});el.addEventListener('drop',e=>{e.preventDefault();if(dragged)move(dragged,draft.sections.findIndex(s=>s.id===el.dataset.section));dragged=null;});el.addEventListener('dragend',()=>{dragged=null;});});
  }
  function move(id,index){if(index<0||index>=draft.sections.length)return;const from=draft.sections.findIndex(s=>s.id===id);if(from<0||from===index)return;draft.sections.splice(index,0,...draft.sections.splice(from,1));sync();invalidate();renderSections();}
  function update(){
    if(!host)return;
    const checks=checkDocument(draft),native=!!desktop()?.previewDocument;
    find('#document-checks').innerHTML=[...checks.errors.map(t=>`<li class="document-error">${esc(t)}</li>`),...[...checks.warnings,...(preview?.warnings||[])].map(t=>`<li>${esc(t)}</li>`),...(!checks.errors.length?['<li>Title and document text ready</li>']:[])].join('');
    find('#document-preview').disabled=busy||checks.errors.length>0||!native;
    find('#document-save-pdf').disabled=busy||!preview||!find('#document-reviewed').checked;
    find('#document-save-draft').disabled=busy||!getSession().access.canWrite||!dirty;
    find('#document-quality').textContent=preview?`${preview.pages} page${preview.pages===1?'':'s'} · A4 · text and margins verified`:'Preview the PDF to check its page layout.';
    find('#document-status').textContent=message||(dirty?'Unsaved draft':draft.expectedRevision?'Draft saved in this case':'New document');
  }
  async function saveDraft(){
    if(!dirty)return true;if(busy||key!==getSession().caseKey)return false;
    busy=true;message='Saving draft…';update();const oldKey=key,snapshot=JSON.parse(JSON.stringify(draft));
    try{const saved=await api('/api/document-drafts',{method:'POST',body:snapshot});if(key!==oldKey)return false;draft.expectedRevision=saved.revision;pages=[saved,...pages.filter(p=>p.id!==saved.id)];changed(signature(draft)!==signature(snapshot));message='Draft saved in this case';return !dirty;}
    catch(e){message=`Not saved: ${e.message}`;return false;}
    finally{busy=false;if(host&&key===oldKey){refreshList();update();}}
  }
  function refreshList(){if(!host)return;find('#document-drafts').innerHTML='<option value="">Open a saved draft…</option>'+pages.map(p=>`<option value="${p.id}">${esc(p.title)}</option>`).join('');}
  async function prepare(){
    if(busy)return;const stamp=JSON.stringify(draft),oldKey=key;busy=true;message='Preparing and checking PDF…';update();
    try{const result=await desktop().previewDocument({caseKey:key,title:draft.title,body:draft.body,sections:draft.sections});if(result.error)throw Error(result.error);if(key!==oldKey)return;if(JSON.stringify(draft)!==stamp){message='Text changed. Preview the updated document.';return;}preview=result;mode='pdf';renderPage();message='Review each page here, then confirm in Quality check.';}
    catch(e){preview=null;message=e.message;}
    finally{busy=false;if(host&&key===oldKey)update();}
  }
  async function exportPDF(){
    if(!preview||!find('#document-reviewed').checked||busy)return;busy=true;update();
    try{const result=await desktop().saveDocumentPDF({caseKey:key,token:preview.token,reviewed:true});if(result.error)throw Error(result.error);if(result.saved){message=result.warning||`PDF saved: ${result.file}`;preview=null;mode='edit';renderPage();find('#document-reviewed').checked=false;await history();}else message='Save cancelled. Your reviewed PDF is still ready.';}
    catch(e){message=e.message;}
    finally{busy=false;if(host)update();}
  }
  async function history(){
    if(!desktop()?.documentHistory)return;const turn=generation;
    try{const result=await desktop().documentHistory({caseKey:key});if(!host||turn!==generation)return;if(result.error)throw Error(result.error);find('#document-history').innerHTML=result.exports.length?result.exports.slice(0,10).map(e=>`<li><b>${esc(e.title)}</b><br>${esc(new Date(e.exportedAt).toLocaleString('en-AU'))} · ${e.pages} pages · reviewed<br><small>SHA-256: ${esc(e.sha256)}</small></li>`).join(''):'<li>No PDFs exported from this case yet.</li>';}
    catch(e){if(host&&turn===generation)find('#document-history').textContent=e.message;}
  }
  async function mount(element, seed){
    generation++;host=element;
    if(key!==getSession().caseKey){key=getSession().caseKey;draft=fresh();pages=[];preview=null;changed(false);}
    if(seed){draft={...fresh(),title:seed.title||'',body:seed.body||''};preview=null;changed(true);message='Imported text. Review it before exporting.';}
    draft ||= fresh();
    if(!preview)mode='edit';
    draft.sections ||= [{id:window.crypto.randomUUID(),type:'header',text:''},...documentSections(draft),{id:window.crypto.randomUUID(),type:'footer',text:''}];
    sync();
    host.innerHTML=`<section class="document-creator"><p class="page-purpose">Create a general document, letter or meeting notes. Drafts stay in this case folder.</p><div class="document-toolbar"><label>Start from<select id="document-template"><option value="general">General document</option><option value="letter">Letter</option><option value="meeting">Meeting notes</option></select></label><button class="btn" id="document-new">New document</button><label>Saved drafts<select id="document-drafts"></select></label><button class="btn" id="document-save-draft">Save draft</button></div><div class="document-columns"><div class="document-editor"><div class="document-view-tabs" role="group" aria-label="Document view"><button class="btn" id="document-edit-view">Layout</button><button class="btn" id="document-pdf-view">PDF preview</button></div><div id="document-canvas" tabindex="0" aria-label="Document pages"></div><p id="document-status" role="status"></p></div><aside class="document-review"><h2>Build your document</h2><p class="document-help">Drag a section or use the arrows to change its position.</p><div id="document-sections"></div><div class="document-add"><select id="document-section-type" aria-label="New section type"><option value="text">Text section</option><option value="header">Header</option><option value="footer">Footer</option></select><button class="btn" id="document-add-section">+ Add section</button></div><details class="document-quality-panel" open><summary>Quality check</summary><ul id="document-checks"></ul><button class="btn primary" id="document-preview">Preview PDF</button>${!desktop()?.previewDocument?'<p>PDF export is available in the desktop app.</p>':''}<p id="document-quality"></p><label class="document-confirm"><input type="checkbox" id="document-reviewed">I checked every PDF page, names, dates, facts and wording.</label><button class="btn primary" id="document-save-pdf">Save reviewed PDF</button><p class="document-help">Layout checks cannot verify facts or suitability for filing. Recheck the preview after editing.</p><details><summary>Export history</summary><ul id="document-history"></ul></details></details></aside></div></section>`;
    find('#document-template').value=selectedTemplate;
    renderSections();renderPage();
    find('#document-edit-view').addEventListener('click',()=>{mode='edit';renderPage();});
    find('#document-pdf-view').addEventListener('click',()=>{if(preview){mode='pdf';renderPage();}});
    find('#document-add-section').addEventListener('click',()=>{if(draft.sections.length>=40){message='Use up to 40 sections.';update();return;}draft.sections.push({id:window.crypto.randomUUID(),type:find('#document-section-type').value,text:''});expanded.set(draft.sections.at(-1).id,true);sync();invalidate();renderSections();find('#document-sections').lastElementChild.querySelector('textarea').focus();});
    find('#document-save-draft').addEventListener('click',saveDraft);find('#document-preview').addEventListener('click',prepare);find('#document-save-pdf').addEventListener('click',exportPDF);find('#document-reviewed').addEventListener('change',update);
    find('#document-new').addEventListener('click',async()=>{if(busy||dirty&&!await saveDraft())return;selectedTemplate=find('#document-template').value;const template=templates[selectedTemplate];draft={...fresh(),...template};preview=null;changed(!!draft.body);message='';await mount(host);});
    find('#document-drafts').addEventListener('change',async e=>{const id=e.target.value;if(!id||busy||dirty&&!await saveDraft())return;const p=pages.find(p=>p.id===id);if(!p)return;draft={id:p.id,title:p.title,body:p.body,sections:p.sections,expectedRevision:p.revision};changed(false);preview=null;message='';await mount(host);});
    refreshList();update();await history();const turn=generation;
    try{const result=await api('/api/document-drafts');if(host&&turn===generation){pages=result.pages;refreshList();}}catch(e){message=e.message;if(host)update();}
  }
  return {mount,unmount(){generation++;host=null;},saveDraft};
}
