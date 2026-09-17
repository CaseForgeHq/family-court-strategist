// Shared by the editor and the native PDF pipeline. Plain text only.
export function documentSections(input) {
  if (input.sections === undefined) return [{id:'title',type:'title',text:input.title}, {id:'body',type:'text',text:input.body}];
  const sections = input.sections;
  if (!Array.isArray(sections) || !sections.length || sections.length > 40 || sections.some(s => !s || !/^[a-zA-Z0-9-]{1,60}$/.test(s.id) || !['header','title','text','footer'].includes(s.type) || typeof s.text !== 'string' || s.text.includes('\0')) || new Set(sections.map(s=>s.id)).size !== sections.length || sections.filter(s=>s.type==='title').length !== 1 || sections.find(s=>s.type==='title').text !== input.title || sections.reduce((n,s)=>n+s.text.length,0)>60140) throw Error('Use up to 40 sections with one document title and 60,000 characters of text.');
  if (sections.filter(s=>s.type!=='title'&&s.text.trim()).map(s=>s.text).join('\n\n') !== input.body) throw Error('Document text and sections disagree. Reopen the draft.');
  return sections.map(({id,type,text})=>({id,type,text}));
}
export const documentText = input => documentSections(input).map(s=>s.text.trim()).join('');
export function checkDocument(input) {
  const errors = [], warnings = [];
  if (!input || typeof input.title !== 'string' || typeof input.body !== 'string') return { errors: ['Enter a document title and text.'], warnings };
  try { documentSections(input); } catch(e) { errors.push(e.message); }
  if (!input.title.trim()) errors.push('Add a document title.');
  if (!input.body.trim()) errors.push('Add some document text.');
  if (input.title.length > 140 || input.body.length > 60000) errors.push('Use a title under 140 characters and text under 60,000 characters.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input.title + input.body)) errors.push('Remove unsupported control characters.');
  if (/\b(?:TODO|TBD|FIXME)\b|\[(?:insert|name|date|address|recipient)[^\]]*\]/i.test(input.title + input.body)) errors.push('Replace the unfinished template placeholders.');
  if (input.title.trim().toLowerCase() === 'untitled page') warnings.push('Consider a more descriptive title.');
  return { errors, warnings };
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function documentHTML(input) {
  const result = checkDocument(input);
  if (result.errors.length) throw Error(result.errors.join(' '));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(input.title)}</title><style>
  @page{size:A4;margin:20mm 20mm 22mm}*{box-sizing:border-box}body{margin:0;color:#182820;font-family:Arial,sans-serif;font-size:11pt;line-height:1.5}h1{font-size:21pt;line-height:1.2;margin:0 0 9mm;overflow-wrap:anywhere;break-after:avoid}p{margin:0 0 4mm;white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3;break-inside:avoid}.header,.footer{font-size:9pt;color:#52635a}.header{border-bottom:1px solid #cbd3cd;margin-bottom:6mm}.footer{border-top:1px solid #cbd3cd;padding-top:4mm} </style></head><body>${documentSections(input).filter(s=>s.text.trim()).map(s=>s.type==='title'?`<h1>${escape(s.text.trim())}</h1>`:`<section class="${s.type}">${s.text.trim().split(/\n\s*\n/).map(p=>`<p>${escape(p)}</p>`).join('')}</section>`).join('')}</body></html>`;
}
export const comparableText = value => String(value).normalize('NFKC').replace(/[\s\u00ad\u200b]/g,'');
