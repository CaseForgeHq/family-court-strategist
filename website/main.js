document.documentElement.classList.add('js');
const toggle = document.querySelector('.menu-toggle');
const navigation = document.getElementById('main-nav');
function closeMenu() { navigation?.classList.remove('open'); toggle?.setAttribute('aria-expanded', 'false'); }
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  navigation.classList.toggle('open', open);
});
navigation?.addEventListener('click', (event) => { if (event.target.closest('a')) closeMenu(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
// The public site must not send visitors to a nonexistent app on their computer.
if (['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
  for (const link of document.querySelectorAll('[data-local-preview]')) {
    link.href = 'http://127.0.0.1:4322/';
    link.hidden = false;
  }
}

const setupURL = new URL('setup.md', document.baseURI).href;
const packageURL = new URL('downloads/case-forge-setup-0.2.0.tgz', document.baseURI).href;
const setupMessage = document.getElementById('setup-message');
if (setupMessage) setupMessage.value = `Read the Case Forge setup guide at ${setupURL} and help me install the free toolkit in a folder I choose. Preserve my existing files, then read CASE-FORGE.md and help me get started.`;
const setupCommand = document.getElementById('setup-command');
if (setupCommand) setupCommand.value = `npx --yes --package "${packageURL}" case-forge init "./My-Case"`;
if (['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
  const note=document.getElementById('setup-local-note'); if(note) note.hidden=false;
}
async function copyText(value, source) {
  const status=document.getElementById('copy-status');
  try {
    await navigator.clipboard.writeText(value);
    status.textContent='Copied. Paste it into your AI or terminal.';
  } catch {
    if(source){source.focus();source.select();}
    status.textContent=source?'Select the highlighted text and copy it.':'Clipboard unavailable. Copy the setup link from the message above.';
  }
}
document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',()=>{const field=document.getElementById(button.dataset.copy);copyText(field.value,field);}));
document.getElementById('copy-setup-link')?.addEventListener('click',()=>copyText(setupURL,setupMessage));
const previewText={overview:'Case overview · see your timeline, records and questions in one workspace.',review:'Document review · check source quotations and choose which findings to save.'};
document.querySelectorAll('[data-preview]').forEach(button=>button.addEventListener('click',()=>{
  const view=button.dataset.preview;
  document.querySelectorAll('[data-preview]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  document.getElementById('desktop-preview').src=`media/desktop-${view}.webp`;
  document.getElementById('desktop-preview').srcset=`media/desktop-${view}-small.webp 720w, media/desktop-${view}.webp 1440w`;
  document.getElementById('desktop-preview').alt=view==='review'?'Desktop document review showing source-matched findings from fictional notes':'Case Forge desktop overview of a fictional case';
  document.getElementById('phone-preview').src=`media/phone-${view}.webp`;
  document.getElementById('phone-preview').srcset=`media/phone-${view}-small.webp 240w, media/phone-${view}.webp 390w`;
  document.getElementById('phone-preview').alt=`Responsive Case Forge ${view==='review'?'document review':'case overview'} inside an iPhone-style frame`;
  document.getElementById('preview-description').textContent=previewText[view];
}));
const signup=document.getElementById('waitlist-form');
if(signup){
  const status=document.getElementById('waitlist-status'),submit=document.getElementById('waitlist-submit');
  const endpoint=window.CASE_FORGE_SITE?.waitlistEndpoint;
  if(endpoint){submit.disabled=false;status.textContent='No payment. No case documents. Just a launch update.';}
  else{status.textContent='Online signup isn’t open on this preview yet. Please check back when the waitlist opens.';}
  signup.addEventListener('submit',async event=>{
    event.preventDefault();if(!endpoint||!signup.reportValidity())return;
    const fields=new FormData(signup);submit.disabled=true;status.className='';status.textContent='Adding you to the waitlist…';
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15_000);
    try {
      const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},signal:controller.signal,body:JSON.stringify({name:fields.get('name'),email:fields.get('email'),platform:fields.get('platform'),company:fields.get('company'),consent:fields.get('consent')==='on'})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'We couldn’t save your signup. Please try again.');
      if(!result.message)throw new Error('We couldn’t confirm your signup. Please try again.');
      status.textContent=result.message;status.className='success';signup.reset();submit.textContent='You’re on the waitlist';
    }catch(error){status.textContent=error.name==='AbortError'?'The connection timed out. Try again; duplicate signups are safely ignored.':error.message;status.className='error';submit.disabled=false;}
    finally{clearTimeout(timer);}
  });
}
