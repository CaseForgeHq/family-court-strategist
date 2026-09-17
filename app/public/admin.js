import { icon } from './icons.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createAdmin({ desktop }) {
  const trigger = document.getElementById('open-admin');
  if (!trigger || typeof desktop?.adminStatus !== 'function') return;
  trigger.hidden = false;
  const dialog = document.createElement('dialog');
  dialog.className = 'admin-dialog';
  dialog.setAttribute('aria-labelledby', 'admin-title');
  dialog.innerHTML = `<header class="admin-heading"><span class="admin-emblem">${icon('shield')}</span><div><span class="admin-eyebrow">ADMIN</span><h2 id="admin-title">Sample data</h2></div><button type="button" class="admin-close" aria-label="Close admin">${icon('close')}</button></header>
    <div class="admin-content"><p class="admin-intro">Explore a case with fictional records.<br><span>Each set opens as a separate local case.</span></p><div class="admin-options"></div><div class="admin-preview" aria-live="polite"></div><p class="admin-status" role="status" aria-live="polite"></p><div class="admin-library"></div></div>
    <footer class="admin-footer"><button type="button" class="admin-return" hidden>${icon('arrowRight')}<span>Previous case</span></button><button type="button" class="admin-create">${icon('plus')}<span>Create &amp; open demo</span></button></footer>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  let state = null, selected = 'small', busy = false, notice = '', loadFailed = false;
  const checked = async promise => { const result = await promise; if (result?.error) throw new Error(result.error); return result; };
  function render() {
    const preset = state?.presets.find(item => item.id === selected);
    $('.admin-options').innerHTML = state ? `<fieldset ${busy ? 'disabled' : ''}><legend>Choose a sample size</legend><div class="admin-sizes">${state.presets.map(item => `<label class="admin-size"><input type="radio" name="demo-size" value="${escape(item.id)}" ${selected === item.id ? 'checked' : ''}><span class="admin-size-name">${escape(item.label)}<span class="admin-radio" aria-hidden="true"></span></span><strong>${item.files}<span> files</span></strong><small>${({ small: 'Quick look', medium: 'Everyday case', large: 'Stress test' })[item.id] || ''}</small></label>`).join('')}</div></fieldset>` : '';
    $('.admin-preview').innerHTML = preset ? `<div>${preset.people} people <span>·</span> ${preset.events} events <span>·</span> ${preset.tasks} tasks</div><small>${preset.notes} journal notes · ${preset.calendar} calendar entries · ${preset.evidence} evidence items · ${preset.patterns} themes</small>` : '';
    $('.admin-status').textContent = notice;
    $('.admin-status').classList.toggle('is-busy', busy);
    $('.admin-options').setAttribute('aria-busy', String(busy));
    $('.admin-create').disabled = busy || !state || loadFailed;
    $('.admin-create span').textContent = busy ? 'Working…' : 'Create & open demo';
    $('.admin-return').hidden = !state?.canReturn;
    $('.admin-return').disabled = busy || loadFailed;
    $('.admin-return').title = state?.returnName ? `Return to ${state.returnName}` : '';
    $('.admin-return span').textContent = state?.returnName ? `Back to ${state.returnName}` : 'Previous case';
    $('.admin-library').innerHTML = state?.entries.length ? `<h3>Saved demos <span>${state.entries.length}</span></h3><div class="admin-demo-list">${state.entries.map(entry => `<div class="admin-demo"><span class="admin-demo-icon">${icon('folder')}</span><div><strong>${escape(entry.label)} <span>· ${entry.files} files</span></strong><small>${escape(new Date(entry.createdAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}${entry.current ? ' · Open now' : !entry.available ? ' · Folder unavailable' : ''}</small></div><button type="button" data-open-demo="${escape(entry.id)}" ${busy || entry.current || !entry.available || loadFailed ? 'disabled' : ''} aria-label="Open ${escape(entry.label)} created ${escape(new Date(entry.createdAt).toLocaleString('en-AU'))}">${entry.current ? 'Current' : 'Open'}${icon('arrowRight')}</button></div>`).join('')}</div>` : '';
  }
  async function refresh() { state = await checked(desktop.adminStatus()); loadFailed = false; render(); }
  async function run(action) {
    if (busy) return;
    busy = true; render();
    try { await action(); }
    catch (error) { notice = error.message || 'Could not complete that action. Please try again.'; }
    finally { busy = false; if (dialog.isConnected) render(); }
  }
  async function openDemo(id) {
    notice = 'Opening your demo…'; render();
    const result = await checked(desktop.adminOpenDemo(id));
    // Native navigation owns the new case; avoid reloading a draft the user kept.
    if (!result?.opened) { notice = 'Your current case is still open. The demo is saved below.'; await refresh(); }
  }
  trigger.addEventListener('click', async () => {
    if (!dialog.open) dialog.showModal();
    $('.admin-close').focus();
    if (busy) return;
    notice = 'Loading your demos…'; render();
    try { await refresh(); notice = ''; render(); }
    catch (error) { loadFailed = true; notice = error.message; render(); }
  });
  $('.admin-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => trigger.focus());
  dialog.addEventListener('change', event => {
    if (event.target.name !== 'demo-size' || busy) return;
    selected = event.target.value; notice = ''; render();
    dialog.querySelector(`input[value="${selected}"]`)?.focus();
  });
  $('.admin-create').addEventListener('click', () => run(async () => {
    const preset = state.presets.find(item => item.id === selected);
    notice = `Creating ${preset.files} files and their connected records…`; render();
    const demo = await checked(desktop.adminCreateDemo(selected));
    await refresh();
    if (dialog.open) await openDemo(demo.id);
    else { notice = 'Demo saved. Open it from Saved demos.'; render(); }
  }));
  $('.admin-library').addEventListener('click', event => {
    const button = event.target.closest('[data-open-demo]');
    if (button && !button.disabled) run(() => openDemo(button.dataset.openDemo));
  });
  $('.admin-return').addEventListener('click', () => run(async () => {
    notice = 'Opening your previous case…'; render();
    const result = await checked(desktop.adminReturnCase());
    if (!result?.opened) notice = 'Your current case is still open.';
  }));
  return { dialog };
}
