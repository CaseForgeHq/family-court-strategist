import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('../../desktop/scene-controls.js', import.meta.url), 'utf8');
const locations = [
  { id: 'brisbane', label: 'Brisbane', timeZone: 'Australia/Brisbane' },
  { id: 'perth', label: 'Perth', timeZone: 'Australia/Perth' },
  { id: 'london', label: 'London', timeZone: 'Europe/London' },
];
const snapshot = (cityId, temperature = 20) => ({ cityId, temperature, condition: 'cloudy', cloudCover: .6, summary: 'Cloudy', fetchedAt: '2026-09-16T12:00:00Z', stale: false });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } assert.fail('Scene controls did not reach expected state'); }
const flush = () => new Promise(setImmediate);

function controls(t, actions = {}) {
  const dom = new JSDOM(`<!doctype html><div id="scene-controls" class="${actions.workspace ? 'workspace-atmosphere' : ''}"></div>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom, { document } = window;
  let now = actions.now ? Date.parse(actions.now) : null;
  if (now !== null) window.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  const intervals = new Map(), timeouts = new Map(), calls = { preferences: 0, saves: [], forecasts: [], effects: [], zones: [] };
  let nextTimer = 0, prefs = { cityId: 'brisbane', weatherEnabled: true, locations: actions.locations || locations }, effect;
  window.setInterval = (callback, delay) => { const id = ++nextTimer; intervals.set(id, { callback, delay }); return id; };
  window.clearInterval = (id) => intervals.delete(id);
  window.setTimeout = (callback, delay) => { const id = ++nextTimer; timeouts.set(id, { callback, delay }); return id; };
  window.clearTimeout = (id) => timeouts.delete(id);
  window.CaseForgeScene = {
    setWeather(value) { effect = value; calls.effects.push(value); },
    setTimezone(value) { calls.zones.push(value); },
  };
  window.strategistDesktop = {
    getScenePreferences: async () => { calls.preferences++; return actions.preferences ? await actions.preferences(calls.preferences) : prefs; },
    setScenePreferences: async (value) => {
      const copy = JSON.parse(JSON.stringify(value)); calls.saves.push(copy);
      const result = actions.save ? await actions.save(copy) : copy;
      if (!result?.error) prefs = { ...prefs, ...copy };
      return result;
    },
    getSceneWeather: async (id) => { calls.forecasts.push(id); return actions.forecast ? await actions.forecast(id, calls.forecasts.length) : snapshot(id); },
  };
  window.eval(script);
  const event = (type) => window.dispatchEvent(new window.Event(type));
  t.after(() => { event('pagehide'); window.close(); });
  return { window, document, intervals, timeouts, calls, event, effect: () => effect,
    advance(ms) { if (now !== null) now += ms; },
    tick() { for (const { callback } of [...intervals.values()]) callback(); },
    choose(index) {
      const slider = document.getElementById('scene-timezone'); slider.value = String(index);
      slider.dispatchEvent(new window.Event('input', { bubbles: true }));
      slider.dispatchEvent(new window.Event('change', { bubbles: true }));
    },
    toggle(value) {
      const checkbox = document.getElementById('scene-weather-toggle'); checkbox.checked = value;
      checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    },
  };
}

test('weather drawer starts closed and closes with its controls, Escape, outside interaction and stage changes', async (t) => {
  const ui = controls(t);
  await until(() => ui.intervals.size === 1);
  const panel = ui.document.getElementById('scene-panel'), tab = ui.document.getElementById('scene-toggle'), close = ui.document.getElementById('scene-close');
  assert.equal(panel.hidden, true);
  assert.equal(tab.getAttribute('aria-expanded'), 'false');
  assert.equal(tab.getAttribute('aria-controls'), panel.id);
  const open = () => {
    tab.click();
    assert.equal(panel.hidden, false);
    assert.equal(tab.getAttribute('aria-expanded'), 'true');
    assert.equal(ui.document.activeElement, close);
  };
  const closed = () => { assert.equal(panel.hidden, true); assert.equal(tab.getAttribute('aria-expanded'), 'false'); };
  open(); close.click(); closed(); assert.equal(ui.document.activeElement, tab);
  open(); tab.click(); closed();
  open(); ui.document.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  closed(); assert.equal(ui.document.activeElement, tab);
  open(); panel.dispatchEvent(new ui.window.Event('pointerdown', { bubbles: true })); assert.equal(panel.hidden, false);
  ui.document.body.dispatchEvent(new ui.window.Event('pointerdown', { bubbles: true })); closed();
  open(); ui.window.dispatchEvent(new ui.window.CustomEvent('caseforge:stage', { detail: { stage: 'ready' } }));
  closed(); assert.equal(ui.document.activeElement, tab);
  assert.equal(ui.calls.preferences, 1); assert.equal(ui.calls.forecasts.length, 1);
  assert.equal(ui.calls.saves.length, 0, 'Opening the drawer must not change preferences');
});

const worldLocations = [...locations,
  { id: 'sydney', label: 'Sydney', timeZone: 'Australia/Sydney' },
  { id: 'new-york', label: 'New York', timeZone: 'America/New_York' },
];
test('workspace clocks handle daylight saving and calendar-day differences without extra weather requests', async (t) => {
  const ui = controls(t, { workspace: true, locations: worldLocations, now: '2026-10-04T15:30:00Z' });
  await until(() => ui.intervals.size === 1);
  assert.equal(ui.document.getElementById('scene-widget-city').textContent, 'Brisbane');
  assert.equal(ui.document.getElementById('scene-widget-time').textContent, '01:30');
  const sydney = ui.document.querySelector('[data-zone="Australia/Sydney"]');
  const london = ui.document.querySelector('[data-zone="Europe/London"]');
  assert.equal(sydney.querySelector('time').textContent, '02:30');
  assert.equal(sydney.querySelector('.world-clock-offset').textContent, 'UTC+11');
  assert.equal(sydney.querySelector('.world-clock-day').textContent, 'Today');
  assert.equal(london.querySelector('time').textContent, '16:30');
  assert.equal(london.querySelector('.world-clock-day').textContent, 'Yesterday');
  assert.equal(ui.document.getElementById('scene-widget-temperature').textContent, '20°');
  for (let i = 0; i < 59; i++) { ui.advance(1000); ui.tick(); }
  assert.equal(ui.calls.forecasts.length, 1);
  ui.advance(1000); ui.tick(); await flush();
  assert.equal(ui.document.getElementById('scene-widget-time').textContent, '01:31');
  assert.equal(ui.calls.forecasts.length, 2);
  ui.document.getElementById('scene-toggle').click();
  ui.event('caseforge:view');
  assert.equal(ui.document.getElementById('scene-panel').hidden, true);
});

test('workspace weather clearly distinguishes saved forecasts, disabled weather and failed forecasts', async (t) => {
  let unavailable = false;
  const ui = controls(t, { workspace: true, locations: worldLocations, now: '2026-09-17T00:00:00Z',
    forecast: async city => unavailable ? { unavailable: true } : { ...snapshot(city, 17), stale: true },
  });
  await until(() => ui.intervals.size === 1);
  assert.equal(ui.document.getElementById('scene-widget-summary').textContent, 'Saved forecast');
  ui.toggle(false); await flush();
  assert.equal(ui.document.getElementById('scene-widget-summary').textContent, 'Weather off');
  assert.equal(ui.document.getElementById('scene-widget-temperature').textContent, '—');
  ui.advance(60000); ui.tick(); await flush();
  assert.equal(ui.calls.forecasts.length, 1);
  unavailable = true; ui.toggle(true); await flush();
  assert.equal(ui.document.getElementById('scene-widget-summary').textContent, 'Unavailable');
  assert.equal(ui.document.getElementById('scene-widget-temperature').textContent, '—');
  assert.equal(ui.document.getElementById('scene-widget-time').textContent, '10:01');
});

test('changing the scene city updates the workspace clock and removes duplicate world clocks', async (t) => {
  const ui = controls(t, { workspace: true, locations: worldLocations, now: '2026-10-04T15:30:00Z' });
  await until(() => ui.intervals.size === 1);
  ui.choose(1); await flush(); // New York, London, Perth, Brisbane, Sydney in slider order.
  assert.equal(ui.document.getElementById('scene-widget-city').textContent, 'London');
  assert.equal(ui.document.getElementById('scene-widget-time').textContent, '16:30');
  assert.equal(ui.document.querySelector('[data-zone="Europe/London"]'), null);
  assert.deepEqual(ui.calls.saves.at(-1), { cityId: 'london', weatherEnabled: true });
  ui.event('pagehide');
  assert.equal(ui.intervals.size, 0);
});

test('pagehide stops refresh and pageshow resumes exactly one current lifecycle', async (t) => {
  const ui = controls(t);
  await until(() => ui.intervals.size === 1);
  assert.equal([...ui.intervals.values()][0].delay, 60000);
  assert.equal(ui.calls.forecasts.length, 1);
  ui.event('pagehide'); assert.equal(ui.intervals.size, 0);
  ui.document.dispatchEvent(new ui.window.Event('visibilitychange')); await flush();
  assert.equal(ui.calls.forecasts.length, 1, 'A hidden lifecycle cannot start weather requests');
  ui.event('pageshow'); ui.event('pageshow');
  await until(() => ui.intervals.size === 1);
  assert.equal(ui.calls.preferences, 2); assert.equal(ui.calls.forecasts.length, 2);
  ui.tick(); await until(() => ui.calls.forecasts.length === 3);
  assert.equal(ui.intervals.size, 1);
});

test('a preference request resolving after pagehide cannot initialize controls or a timer', async (t) => {
  const late = deferred();
  const ui = controls(t, { preferences: async (call) => call === 1 ? late.promise : { cityId: 'london', weatherEnabled: true, locations } });
  assert.equal(ui.calls.preferences, 1);
  ui.event('pagehide'); late.resolve({ cityId: 'perth', weatherEnabled: true, locations }); await flush();
  assert.equal(ui.intervals.size, 0); assert.equal(ui.calls.forecasts.length, 0); assert.equal(ui.calls.zones.length, 0);
  assert.equal(ui.document.getElementById('scene-timezone').disabled, true);
  ui.event('pageshow'); await until(() => ui.intervals.size === 1);
  assert.equal(ui.document.getElementById('scene-city-label').textContent, 'London');
  assert.deepEqual(ui.calls.forecasts, ['london']);
});

test('a forecast resolving after pagehide cannot replace the restored scene or add another timer', async (t) => {
  const late = deferred();
  const ui = controls(t, { forecast: async (id, call) => call === 1 ? late.promise : snapshot(id, 25) });
  await until(() => ui.calls.forecasts.length === 1);
  ui.event('pagehide'); ui.event('pageshow');
  await until(() => ui.intervals.size === 1 && ui.effect()?.temperature === 25);
  late.resolve(snapshot('brisbane', 5)); await flush();
  assert.equal(ui.effect().temperature, 25);
  assert.equal(ui.intervals.size, 1);
  assert.equal(ui.calls.effects.filter(Boolean).length, 1);
});

for (const fails of [false, true]) {
  test('older city ' + (fails ? 'errors' : 'forecasts') + ' cannot overwrite the newly selected city', async (t) => {
    const old = deferred(), current = deferred();
    const ui = controls(t, { forecast: async (_id, call) => call === 1 ? old.promise : current.promise });
    await until(() => ui.calls.forecasts.length === 1);
    ui.choose(1); // The controller orders the supplied locations London, Perth, Brisbane.
    await until(() => ui.calls.forecasts.length === 2);
    assert.deepEqual(ui.calls.saves, [{ cityId: 'perth', weatherEnabled: true }]);
    assert.equal(ui.timeouts.size, 0, 'The final change event cancels the pending slider debounce');
    current.resolve(snapshot('perth', 28)); await until(() => ui.effect()?.cityId === 'perth');
    if (fails) old.reject(new Error('Old city is offline')); else old.resolve(snapshot('brisbane', 4));
    await flush();
    assert.equal(ui.effect().cityId, 'perth'); assert.equal(ui.effect().temperature, 28);
    assert.equal(ui.document.getElementById('scene-city-label').textContent, 'Perth');
    assert.match(ui.document.getElementById('scene-weather-status').textContent, /^28°/);
    assert.equal(ui.calls.effects.filter(Boolean).length, 1);
  });
}

test('weather off clears effects immediately, saves the preference and ignores pending forecasts', async (t) => {
  const pending = deferred();
  const ui = controls(t, { forecast: async (id, call) => call === 1 ? snapshot(id) : pending.promise });
  await until(() => ui.intervals.size === 1);
  assert.equal(ui.effect().cityId, 'brisbane');
  ui.tick(); await until(() => ui.calls.forecasts.length === 2);
  ui.toggle(false);
  assert.equal(ui.effect(), null);
  assert.equal(ui.document.getElementById('scene-weather-status').textContent, 'Weather off · time of day only');
  assert.equal(ui.document.getElementById('scene-weather-status').title, '');
  await until(() => ui.calls.saves.length === 1);
  assert.deepEqual(ui.calls.saves[0], { cityId: 'brisbane', weatherEnabled: false });
  pending.resolve(snapshot('brisbane', 99)); await flush();
  assert.equal(ui.effect(), null);
  ui.tick(); await flush(); assert.equal(ui.calls.forecasts.length, 2);
  assert.equal(ui.document.getElementById('scene-weather-status').textContent, 'Weather off · time of day only');
});
