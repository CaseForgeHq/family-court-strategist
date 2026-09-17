import { icon } from './icons.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createCaseMenu({ desktop, getName, settings, chooseFolder, createCase, showError }) {
  const trigger = document.getElementById('current-matter'), host = document.getElementById('case-menu');
  function close(focus = false) { host.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if(focus) trigger.focus(); }
  function open() {
    host.innerHTML = `<p class="case-menu-label">OPEN CASE</p><div class="case-menu-current"><span>${icon('folder')}<span><strong>${esc(getName())}</strong><small>Current case</small></span></span><button type="button" class="icon-button" data-case-action="settings" aria-label="Current case settings" title="Case settings">${icon('gear')}</button><button type="button" class="icon-button" data-case-action="close" aria-label="Close current case" title="Close case · saved files stay in their folder" ${desktop?.closeCase ? '' : 'disabled'}>${icon('close')}</button></div><div class="case-menu-actions"><button type="button" data-case-action="create">${icon('plus')}Create new case</button><button type="button" data-case-action="open">${icon('folder')}Open another case…</button></div>`;
    host.hidden = false; trigger.setAttribute('aria-expanded', 'true');
  }
  trigger.addEventListener('click', () => host.hidden ? open() : close());
  trigger.addEventListener('keydown', e => { if(e.key === 'ArrowDown') { e.preventDefault(); open(); host.querySelector('button:not(:disabled)')?.focus(); } });
  host.addEventListener('click', async e => {
    const button = e.target.closest('[data-case-action]'); if(!button || button.disabled) return;
    const action = button.dataset.caseAction; close();
    if(action === 'settings') return settings();
    if(action === 'create') return createCase();
    if(action === 'open') return chooseFolder();
    try { const result = await desktop.closeCase(); if(result?.error) throw new Error(result.error); }
    catch(error) { showError(error.message); }
  });
  host.addEventListener('keydown', e => {
    if(!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); const buttons = [...host.querySelectorAll('button:not(:disabled)')], i = buttons.indexOf(document.activeElement);
    buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  });
  document.addEventListener('pointerdown', e => { if(!e.target.closest('.case-selector')) close(); });
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && !host.hidden) { e.preventDefault(); close(true); } });
  document.addEventListener('focusin', e => { if(!e.target.closest('.case-selector')) close(); });
  window.addEventListener('caseforge:view', () => close());
  return { close };
}
