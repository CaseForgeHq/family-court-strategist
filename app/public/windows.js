import { icon } from './icons.js';
// Movable in-app inspectors. Coordinates never leave the current app window.
export function makeWindow(panel, { title, onClose, anchor } = {}) {
  const doc = panel.ownerDocument, win = doc.defaultView;
  const bar = doc.createElement('div'); bar.className = 'window-bar';
  bar.innerHTML = `<span class="window-grip" tabindex="0" role="button" aria-label="Move window. Drag, or use arrow keys. Home centres it.">${icon('grip')}<span></span></span><div class="window-actions"><button type="button" data-window-place="left" title="Dock left" aria-label="Dock left">${icon('panelLeft')}</button><button type="button" data-window-place="float" title="Float in centre" aria-label="Float in centre">${icon('space')}</button><button type="button" data-window-place="right" title="Dock right" aria-label="Dock right">${icon('panelRight')}</button>${onClose ? `<button type="button" data-window-close aria-label="Close window">${icon('close')}</button>` : ''}</div>`;
  bar.querySelector('.window-grip>span').textContent = title || 'Case Forge';
  panel.prepend(bar); panel.classList.add('movable-window');
  const grip = bar.querySelector('.window-grip');
  let dragging = null;
  function setMode(mode) {
    panel.dataset.windowMode = mode;
    bar.querySelectorAll('[data-window-place]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.windowPlace === mode)));
  }
  const gap = () => parseFloat(win.getComputedStyle(doc.documentElement).getPropertyValue('--page-gutter')) || 24;
  const topEdge = () => Math.min((doc.querySelector('.workspace-shell')?.getBoundingClientRect().bottom || 0) + 12, win.innerHeight - 240);
  function position(left, top) {
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(gap(), Math.min(left, win.innerWidth - rect.width - gap()))}px`;
    panel.style.top = `${Math.max(topEdge(), Math.min(top, win.innerHeight - 180 - gap()))}px`;
    panel.style.height = `${Math.max(180, Math.min(win.innerHeight - parseFloat(panel.style.top) - gap(), 640))}px`;
  }
  function place(mode = 'right') {
    setMode(mode);
    panel.style.width = `${Math.min(mode === 'float' ? 490 : Math.max(370, win.innerWidth * .38), win.innerWidth - gap() * 2)}px`;
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
    const width = parseFloat(panel.style.width);
    position(mode === 'left' ? gap() : mode === 'right' ? win.innerWidth - width - gap() : (win.innerWidth - width) / 2, mode === 'float' ? topEdge() : Math.max(topEdge(), anchor?.getBoundingClientRect().top || 0));
  }
  const down = event => {
    if (event.button !== 0) return;
    const rect = panel.getBoundingClientRect(); dragging = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    grip.setPointerCapture?.(event.pointerId); panel.classList.add('window-dragging'); event.preventDefault();
  };
  const move = event => { if (dragging) { setMode('float'); position(dragging.left + event.clientX - dragging.x, dragging.top + event.clientY - dragging.y); } };
  const up = event => { if (!dragging) return; dragging = null; panel.classList.remove('window-dragging'); if (event.clientX < 50) place('left'); else if (event.clientX > win.innerWidth - 50) place('right'); };
  const key = event => {
    const r = panel.getBoundingClientRect(), amount = event.shiftKey ? 40 : 16;
    if (event.key === 'Home' || event.key === 'Enter') { event.preventDefault(); place('float'); }
    else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) { event.preventDefault(); setMode('float'); position(r.left + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0), r.top + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0)); }
  };
  const click = event => { const button = event.target.closest('[data-window-place]'); if (button) place(button.dataset.windowPlace); if (event.target.closest('[data-window-close]')) onClose?.(); };
  const resize = () => { if (!panel.hidden) place(panel.dataset.windowMode || 'right'); };
  grip.addEventListener('pointerdown', down); grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up); grip.addEventListener('keydown', key);
  bar.addEventListener('click', click); win.addEventListener('resize', resize); place('right');
  return { place, destroy() { win.removeEventListener('resize', resize); bar.remove(); } };
}
