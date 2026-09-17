import { hydrateIcons } from './icons.js';
import { makeWindow } from './windows.js';
hydrateIcons();
// Layout preferences only. Case data and the local scene are owned elsewhere.
const body = document.body;
const context = document.getElementById('toggle-context');
const panel = document.getElementById('workspace-context');
let panelOpener = context;
const menus = [...document.querySelectorAll('.workspace-nav > details')];
function closeNavigationMenus(except = null, restoreFocus = false) {
  for (const menu of menus) if (menu !== except && menu.open) {
    if (restoreFocus && menu.contains(document.activeElement)) menu.querySelector('summary').focus({ preventScroll: true });
    menu.open = false;
  }
}
for (const menu of menus) menu.addEventListener('toggle', () => { if (menu.open) closeNavigationMenus(menu); });
function setContext(open, restoreFocus = false) {
  if(open && body.dataset.contextOpen !== 'true') panelOpener = document.activeElement;
  body.dataset.contextOpen = String(open);
  panel.hidden = !open; panel.inert = !open;
  context.setAttribute('aria-expanded', String(open));
  if (open) { if (panel.dataset.windowMode !== 'float') panelWindow?.place(panel.dataset.windowMode || 'right'); document.getElementById('close-context').focus({ preventScroll:true }); }
  else if (restoreFocus || panel.contains(document.activeElement)) (panelOpener?.isConnected && !panel.contains(panelOpener) ? panelOpener : context).focus({ preventScroll:true });
}
function selectPanel(name = 'details') {
  for (const key of ['details', 'ai']) document.getElementById(`panel-${key}`).hidden = key !== name;
  panel.querySelectorAll('[data-panel]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.panel === name)));
  body.dataset.panel = name;
  window.dispatchEvent(new CustomEvent('caseforge:panel-selected', { detail:{ name } }));
}
let panelWindow;
setContext(false);
panelWindow = makeWindow(panel, { title: 'Case panel', anchor: () => document.querySelector('#view > .case-desk,#view > .files-ai-workbench,#view .case-map-shell') || document.getElementById('view'), alignToAnchor: true });
context.addEventListener('click', () => setContext(body.dataset.contextOpen !== 'true'));
panel.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => selectPanel(button.dataset.panel)));
window.addEventListener('caseforge:open-panel', event => { selectPanel(event.detail?.name || 'details'); setContext(true); });
document.getElementById('close-context').addEventListener('click', () => setContext(false, true));
document.addEventListener('keydown', event => {
  if (event.defaultPrevented) return;
  if (event.key === 'Escape' && document.getElementById('modal-back').hidden) {
    if (body.dataset.contextOpen === 'true') setContext(false, true);
    else closeNavigationMenus(null, true);
  }
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.workspace-nav > details')) closeNavigationMenus();
});
window.addEventListener('caseforge:view', () => {
  closeNavigationMenus(null, true);
  if (body.dataset.contextOpen === 'true' && panel.dataset.windowMode !== 'float') window.requestAnimationFrame(() => panelWindow.place(panel.dataset.windowMode || 'right'));
});
