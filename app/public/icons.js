// One icon vocabulary for navigation, menus and workspace actions.
// 24px outline grid; decorative icons inherit the control's accessible label.
export const ICONS = Object.freeze({
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  space: '<path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/>',
  fly: '<path d="m3 11 18-8-8 18-2-8zM11 13l10-10"/>',
  focus: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><circle cx="12" cy="12" r="3"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  minus: '<path d="M5 12h14"/>',
  arrowRight: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  desk: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  folder: '<path d="M3 8V5h7l3 3h8v12H3zM3 11h18"/>',
  map: '<rect x="3" y="3" width="6" height="6" rx="2"/><rect x="15" y="3" width="6" height="6" rx="2"/><rect x="9" y="15" width="6" height="6" rx="2"/><path d="M6 9v3h12V9M12 12v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M17 5a3 3 0 0 1 0 6M21 20v-2a4 4 0 0 0-3-3.9"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M7 15h2M15 15h2M7 18h2"/>',
  tasks: '<path d="m3 7 2 2 4-4M12 7h9M3 16l2 2 4-4M12 16h9"/>',
  notebook: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9 3v18M13 8h3M13 12h3"/>',
  tools: '<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M9 12v3M15 12v3"/>',
  evidence: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h18M13 13h4M13 17h4"/>',
  patterns: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  print: '<path d="M6 9V3h12v6M6 18H3V9h18v9h-3M6 14h12v7H6zM17 11h1"/>',
  book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1v15"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  gear: '<path d="m9.5 3-.6 2.2-1.5.9-2.2-.6-2.5 4.3 1.6 1.6v1.8l-1.6 1.6 2.5 4.3 2.2-.6 1.5.9.6 2.2h5l.6-2.2 1.5-.9 2.2.6 2.5-4.3-1.6-1.6v-1.8l1.6-1.6-2.5-4.3-2.2.6-1.5-.9-.6-2.2z"/><circle cx="12" cy="12" r="3"/>',
  ai: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4zM20 3v4M18 5h4"/>',
  panelLeft: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  panelRight: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="m3 3 18 9-18 9 3-9zM6 12h15"/>',
  link: '<path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  shield: '<path d="M12 2.5 21 6v6c0 4.7-5.2 8.3-9 9.5C8.2 20.3 3 16.7 3 12V6Z" fill="#3989df" stroke="#2569b2"/><path d="m8 11.7 2.7 2.7 5.4-5.4" stroke="#f4f9ff" stroke-width="2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  grip: '<path d="M8 5h.01M8 12h.01M8 19h.01M15 5h.01M15 12h.01M15 19h.01" stroke-width="3"/>',
  settings: '<path d="M3 6h4M11 6h10M3 12h10M17 12h4M3 18h4M11 18h10"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>'
});
export function icon(name) {
  if (!Object.hasOwn(ICONS, name)) throw new Error(`Unknown workspace icon: ${name}`);
  return `<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); });
}
