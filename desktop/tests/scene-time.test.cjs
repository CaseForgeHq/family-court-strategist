const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { getState } = require('../scene-time.js');
const local = (hour, minute = 0, second = 0, millisecond = 0) => new Date(2026, 8, 16, hour, minute, second, millisecond);
const components = (value) => String(value).match(/-?\d*\.?\d+/g).map(Number);

test('local clock boundaries select the requested scene and readable UI mode', () => {
  for (const [hour, minute, phase] of [[0, 0, 'night'], [4, 30, 'night'], [6, 0, 'dawn'], [8, 0, 'morning'], [12, 0, 'noon'], [16, 0, 'afternoon'], [18, 0, 'dusk'], [19, 30, 'blue-hour'], [21, 0, 'night']]) {
    assert.equal(getState(local(hour, minute)).phase, phase);
  }
  assert.equal(getState(local(6, 59, 59)).mode, 'dark');
  assert.equal(getState(local(7)).mode, 'light');
  assert.equal(getState(local(17, 59, 59)).mode, 'light');
  assert.equal(getState(local(18)).mode, 'dark');
  const date = local(8);
  for (const method of ['getUTCHours', 'getUTCMinutes', 'getUTCSeconds']) date[method] = () => { throw new Error('UTC must not determine the local scene'); };
  assert.equal(getState(date).phase, 'morning');
});

test('minutes and seconds interpolate artwork instead of snapping once an hour', () => {
  const first = getState(local(10, 15)), later = getState(local(10, 15, 30)), minute = getState(local(10, 16));
  assert.equal(first.phase, later.phase);
  assert.notEqual(first.variables['--sky-top'], later.variables['--sky-top']);
  assert.ok(parseFloat(first.variables['--sun-x']) < parseFloat(later.variables['--sun-x']));
  assert.ok(parseFloat(later.variables['--sun-x']) < parseFloat(minute.variables['--sun-x']));
  assert.ok(parseFloat(first.variables['--sun-y']) > parseFloat(later.variables['--sun-y']));
  assert.throws(() => getState(new Date(NaN)), /valid local date/);
});

test('artwork stays continuous at every keyframe and across midnight', () => {
  const artKeys = Object.keys(getState(local(12)).variables).filter((key) => /sky|peak|ridge|forest|facet|mist|page-bg|daylight|sun-|moon-|stars-|glow-/.test(key));
  for (const [hour, minute] of [[0, 0], [4, 30], [6, 0], [8, 0], [12, 0], [16, 0], [18, 0], [19, 30], [21, 0]]) {
    const edge = local(hour, minute), before = getState(new Date(edge.getTime() - 1)), after = getState(new Date(edge.getTime() + 1));
    for (const key of artKeys) {
      const a = components(before.variables[key]), b = components(after.variables[key]);
      assert.equal(a.length, b.length);
      a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) < .002, `${key} jumps at ${hour}:${minute}`));
    }
  }
  assert.deepEqual(getState(local(0)).variables, getState(local(24)).variables);
});

test('every five-minute sample produces finite CSS values and bounded celestial coordinates', () => {
  const expected = ['sky-top', 'sky-mid', 'sky-horizon', 'peak-far', 'peak-mid', 'ridge-back', 'ridge-front', 'forest', 'facet', 'mist',
    'sun-x', 'sun-y', 'sun-opacity', 'moon-x', 'moon-y', 'moon-opacity', 'stars-opacity', 'glow-opacity', 'daylight',
    'cream', 'copy', 'quiet', 'line', 'focus', 'card-bg', 'input-bg', 'input-line', 'input-placeholder', 'button-bg', 'button-line', 'button-hover', 'button-hover-line', 'icon', 'message', 'page-bg'];
  for (let minute = 0; minute < 1440; minute += 5) {
    const { variables } = getState(local(0, minute));
    assert.deepEqual(Object.keys(variables).sort(), expected.map((name) => `--${name}`).sort());
    for (const [name, value] of Object.entries(variables)) {
      assert.doesNotMatch(value, /NaN|Infinity|undefined/);
      if (value.startsWith('#')) { assert.match(value, /^#[\da-f]{6}$/i); continue; }
      const values = components(value);
      assert.ok(values.every(Number.isFinite));
      if (/opacity|daylight/.test(name)) assert.ok(values[0] >= 0 && values[0] <= 1, name);
      if (/-(x|y)$/.test(name)) { assert.match(value, /%$/); assert.ok(values[0] >= 0 && values[0] <= 100); }
      if (value.startsWith('rgb')) {
        values.slice(0, 3).forEach((channel) => assert.ok(channel >= 0 && channel <= 255));
        if (values.length === 4) assert.ok(values[3] >= 0 && values[3] <= 1);
      }
    }
  }
});

function rgb(value) { return value.startsWith('#') ? [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) : components(value); }
function luminance(channels) {
  const linear = channels.slice(0, 3).map((channel) => channel / 255).map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
test('small card text keeps readable contrast over all interpolated landscape colours', () => {
  for (let minute = 0; minute < 1440; minute += 30) {
    const { variables } = getState(local(0, minute)), card = rgb(variables['--card-bg']);
    for (const background of ['--sky-top', '--sky-mid', '--sky-horizon', '--peak-far', '--forest']) {
      const behind = rgb(variables[background]), composite = behind.map((channel, i) => card[i] * card[3] + channel * (1 - card[3]));
      for (const text of ['--cream', '--copy', '--quiet', '--input-placeholder', '--message']) {
        const a = luminance(rgb(variables[text])), b = luminance(composite);
        assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${text} lacks contrast at minute ${minute} over ${background}`);
      }
    }
  }
});

function target() {
  const events = new Map();
  return {
    addEventListener(type, callback, options) { if (!events.has(type)) events.set(type, new Map()); events.get(type).set(callback, options); },
    removeEventListener(type, callback) { events.get(type)?.delete(callback); },
    fire(type) { for (const [callback, options] of [...(events.get(type) || [])]) { if (options?.once) events.get(type).delete(callback); callback({ type }); } },
    count(type) { return events.get(type)?.size || 0; },
  };
}
function browserFixture(hour = 6) {
  let now = local(hour).getTime(), logo = null, nextTimer = 0;
  const values = new Map(), timers = new Map(), document = Object.assign(target(), {
    readyState: 'loading', visibilityState: 'visible',
    documentElement: { dataset: {}, style: { setProperty: (key, value) => values.set(key, value) } },
    querySelector(selector) { assert.equal(selector, 'body > header img'); return logo; },
  });
  const window = Object.assign(target(), { document,
    setInterval(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearInterval(id) { timers.delete(id); },
  });
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
  vm.runInNewContext(readFileSync(join(__dirname, '../scene-time.js'), 'utf8'), { window, Date: ClockDate });
  return { window, document, timers, values,
    setTime(hour, minute = 0) { now = local(hour, minute).getTime(); },
    ready(source = 'brand/logo-reversed.svg') {
      logo = { source, writes: 0, getAttribute: () => logo.source, setAttribute(name, value) { assert.equal(name, 'src'); logo.source = value; logo.writes++; } };
      document.readyState = 'complete'; document.fire('DOMContentLoaded'); return logo;
    },
  };
}

test('browser updates CSS before DOM readiness and swaps only the known logo as mode changes', () => {
  const fixture = browserFixture(8), { window, document, values } = fixture;
  assert.equal(document.documentElement.dataset.sceneMode, 'light');
  assert.equal(document.documentElement.dataset.sceneReady, 'true');
  assert.equal(values.get('--sun-x'), getState(local(8)).variables['--sun-x']);
  const logo = fixture.ready(); assert.equal(logo.source, 'brand/logo.svg'); assert.equal(logo.writes, 1);
  window.CaseForgeScene.update(local(12)); assert.equal(logo.writes, 1);
  const returned = window.CaseForgeScene.update(local(21));
  assert.equal(returned.phase, 'night'); assert.equal(logo.source, 'brand/logo-reversed.svg'); assert.equal(logo.writes, 2);
  logo.source = 'other-image.svg'; window.CaseForgeScene.update(local(12)); assert.equal(logo.source, 'other-image.svg');
});

test('focus, visibility and timer refresh read the current clock after a long sleep', () => {
  const fixture = browserFixture(6), { window, document, timers } = fixture;
  fixture.ready(); assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay, 30000);
  fixture.setTime(12); window.fire('focus'); assert.equal(document.documentElement.dataset.scenePhase, 'noon');
  document.visibilityState = 'hidden'; fixture.setTime(19, 45);
  [...timers.values()][0].callback(); assert.equal(document.documentElement.dataset.scenePhase, 'noon');
  document.visibilityState = 'visible'; document.fire('visibilitychange'); assert.equal(document.documentElement.dataset.scenePhase, 'blue-hour');
  fixture.setTime(22); [...timers.values()][0].callback(); assert.equal(document.documentElement.dataset.scenePhase, 'night');
});

test('pagehide removes timer and refresh handlers; pageshow restarts once with current time', () => {
  const fixture = browserFixture(12), { window, document, timers } = fixture;
  fixture.ready(); window.fire('pagehide');
  assert.equal(timers.size, 0); assert.equal(window.count('focus'), 0); assert.equal(document.count('visibilitychange'), 0);
  fixture.setTime(21); window.fire('focus'); assert.equal(document.documentElement.dataset.sceneMode, 'light');
  window.fire('pageshow'); assert.equal(document.documentElement.dataset.sceneMode, 'dark');
  assert.equal(timers.size, 1); assert.equal(window.count('focus'), 1); assert.equal(document.count('visibilitychange'), 1);
  window.fire('pageshow'); assert.equal(timers.size, 1); assert.equal(window.count('focus'), 1);
  window.fire('pagehide'); assert.equal(timers.size, 0);
});

test('selected IANA zones use their local clock, including daylight-saving transitions and half hours', () => {
  const instant = new Date('2026-09-16T00:00:00.000Z');
  assert.equal(getState(instant, 'Australia/Perth').phase, 'morning');
  assert.equal(getState(instant, 'America/New_York').phase, 'blue-hour');
  assert.deepEqual(getState(instant, 'Australia/Darwin').variables, getState(local(9, 30)).variables);
  assert.deepEqual(getState(new Date('2026-03-29T00:30:00Z'), 'Europe/London').variables, getState(local(0, 30)).variables);
  assert.deepEqual(getState(new Date('2026-03-29T01:30:00Z'), 'Europe/London').variables, getState(local(2, 30)).variables);
  assert.deepEqual(getState(new Date('2026-10-04T15:00:00Z'), 'Australia/Sydney').variables, getState(local(2)).variables);
  assert.throws(() => getState(instant, 'invalid/timezone'), /time zone/i);
});

test('timezone preference affects update but does not change the pure local getState contract', () => {
  const { window } = browserFixture(12), scene = window.CaseForgeScene, instant = new Date('2026-09-16T00:00:00Z');
  assert.equal(scene.getTimezone(), null); assert.equal(scene.setTimezone('Australia/Perth'), 'Australia/Perth');
  assert.equal(scene.getTimezone(), 'Australia/Perth'); assert.equal(scene.update(instant).phase, 'morning');
  assert.equal(scene.getState(instant).phase, getState(instant).phase);
  assert.throws(() => scene.setTimezone('bad/zone')); assert.equal(scene.getTimezone(), 'Australia/Perth');
  scene.setTimezone(null); assert.equal(scene.getTimezone(), null); assert.equal(scene.update(local(12)).phase, 'noon');
});

test('weather tints artwork and adds bounded effects without inventing clear weather for missing data', () => {
  const { window, document, values } = browserFixture(12), scene = window.CaseForgeScene;
  assert.equal(document.documentElement.dataset.weather, 'unknown');
  scene.setWeather({ condition: 'rain', cloudCover: .9, precipitation: 2 });
  const rain = scene.update(local(12));
  assert.equal(document.documentElement.dataset.weather, 'rain');
  assert.equal(values.get('--weather-cloud'), '0.9'); assert.ok(Number(values.get('--weather-rain')) > 0);
  assert.ok(Number(rain.variables['--sun-opacity']) < Number(getState(local(12)).variables['--sun-opacity']));
  assert.notEqual(rain.variables['--sky-top'], getState(local(12)).variables['--sky-top']);
  assert.equal(rain.variables['--cream'], getState(local(12)).variables['--cream']);
  scene.setWeather({ condition: 'snow', cloudCover: 1, precipitation: 1000 });
  assert.equal(values.get('--weather-snow'), '1'); assert.equal(values.get('--weather-rain'), '0');
  scene.setWeather({ condition: 'fog', cloudCover: .8 }); assert.equal(values.get('--weather-fog'), '1');
  scene.setWeather({ condition: 'storm', cloudCover: 1, precipitation: 50 }); assert.equal(values.get('--weather-rain'), '1');
  for (const invalid of [null, { unavailable: true, condition: 'clear', cloudCover: 0 }, { condition: 'unknown' }, { condition: 'rain', cloudCover: Infinity }]) {
    scene.setWeather(invalid); assert.equal(document.documentElement.dataset.weather, 'unknown');
    assert.equal(values.get('--weather-cloud'), '0'); assert.equal(values.get('--weather-rain'), '0');
  }
});

test('scene visibility marker pauses decorative effects while hidden or away', () => {
  const { window, document } = browserFixture(12);
  assert.equal(document.documentElement.dataset.sceneHidden, 'false');
  document.visibilityState = 'hidden'; document.fire('visibilitychange'); assert.equal(document.documentElement.dataset.sceneHidden, 'true');
  document.visibilityState = 'visible'; document.fire('visibilitychange'); assert.equal(document.documentElement.dataset.sceneHidden, 'false');
  window.fire('pagehide'); assert.equal(document.documentElement.dataset.sceneHidden, 'true');
  window.fire('pageshow'); assert.equal(document.documentElement.dataset.sceneHidden, 'false');
});

test('rain intensity uses hourly precipitation across one, six and twelve hour forecasts', () => {
  const { window, values } = browserFixture(12);
  for (const hours of [1, 6, 12]) {
    window.CaseForgeScene.setWeather({ condition: 'rain', cloudCover: 1, precipitation: 2 * hours, precipitationHours: hours });
    assert.equal(values.get('--weather-rain'), '0.5');
  }
});
