(function (browser) {
  'use strict';

  // A decorative local-clock cycle, not an estimate of sunrise for a location.
  // Duplicate night endpoints keep the artwork continuous across midnight.
  const colorNames = ['sky-top', 'sky-mid', 'sky-horizon', 'peak-far', 'peak-mid', 'ridge-back', 'ridge-front', 'forest', 'facet', 'mist', 'page-bg'];
  const frames = [
    { hour: 0, phase: 'night', colors: ['#081824', '#183345', '#365063', '#263e52', '#20394c', '#183443', '#122d36', '#0a252d', '#355362', '#68818a', '#0b1a25'], light: 0, sun: [12, 82, 0], moon: [54, 19, 1], stars: .9, glow: .08 },
    { hour: 4.5, phase: 'night', colors: ['#102134', '#354659', '#776777', '#4b526c', '#38495e', '#2b4251', '#203b43', '#122f36', '#5b6a76', '#8e8f9b', '#142635'], light: .03, sun: [10, 82, 0], moon: [86, 51, .7], stars: .65, glow: .12 },
    { hour: 6, phase: 'dawn', colors: ['#485b78', '#ad8d91', '#f1c19b', '#827d94', '#6d7d87', '#577778', '#406562', '#244f4d', '#b2a49e', '#d3bdae', '#697b89'], light: .3, sun: [12, 64, .72], moon: [94, 75, .08], stars: .12, glow: .8 },
    { hour: 8, phase: 'morning', colors: ['#85b4c7', '#b7d1d1', '#f4e4c4', '#92abb1', '#829f9f', '#6c9388', '#517d70', '#315e50', '#b6c7b4', '#dce2ca', '#b9d0cf'], light: .82, sun: [25, 36, .98], moon: [8, 82, 0], stars: 0, glow: .55 },
    { hour: 12, phase: 'noon', colors: ['#78afc8', '#acd0d8', '#edf0d7', '#86a6b1', '#769b9a', '#608e80', '#467568', '#28594b', '#b0ccbc', '#d6e6d7', '#afcfd4'], light: 1, sun: [49, 15, 1], moon: [9, 82, 0], stars: 0, glow: .32 },
    { hour: 16, phase: 'afternoon', colors: ['#8aaeb8', '#ccd0ba', '#efd5a5', '#9daca5', '#869e8d', '#728f74', '#597958', '#385e43', '#c5c5a1', '#dedac0', '#c2cbbb'], light: .83, sun: [73, 31, .96], moon: [10, 82, 0], stars: 0, glow: .58 },
    { hour: 18, phase: 'dusk', colors: ['#5b5577', '#b47e83', '#edb483', '#897b91', '#6d7882', '#526e73', '#365b60', '#21464d', '#b89a94', '#c6acac', '#7c7c87'], light: .35, sun: [88, 66, .76], moon: [14, 71, .03], stars: .05, glow: .84 },
    { hour: 19.5, phase: 'blue-hour', colors: ['#26354e', '#4a5975', '#8e8197', '#505c7b', '#3c526b', '#2b475b', '#203c4b', '#12313e', '#647187', '#9697ab', '#283c51'], light: .07, sun: [93, 82, .02], moon: [25, 39, .68], stars: .55, glow: .24 },
    { hour: 21, phase: 'night', colors: ['#0b1d2c', '#1b344b', '#3b506c', '#2b405b', '#233b51', '#1a3546', '#142e3a', '#0d2731', '#3d566b', '#748896', '#0e2030'], light: 0, sun: [94, 86, 0], moon: [34, 26, 1], stars: .9, glow: .08 },
    { hour: 24, phase: 'night', colors: ['#081824', '#183345', '#365063', '#263e52', '#20394c', '#183443', '#122d36', '#0a252d', '#355362', '#68818a', '#0b1a25'], light: 0, sun: [12, 82, 0], moon: [54, 19, 1], stars: .9, glow: .08 },
  ];
  const ui = {
    light: {
      cream: '#203a3e', copy: '#354d50', quiet: '#40575a', line: 'rgba(35, 64, 66, 0.24)', focus: '#825326',
      'card-bg': 'rgba(250, 248, 239, 0.8)', 'input-bg': 'rgba(255, 254, 247, 0.62)', 'input-line': 'rgba(44, 74, 75, 0.48)',
      'input-placeholder': '#445b5e', 'button-bg': 'rgba(226, 231, 219, 0.5)', 'button-line': 'rgba(43, 70, 68, 0.46)',
      'button-hover': 'rgba(210, 222, 205, 0.95)', 'button-hover-line': 'rgba(43, 70, 68, 0.75)', icon: '#6e512d', message: '#783d23',
    },
    dark: {
      cream: '#f8f4ec', copy: '#d6dfd8', quiet: '#bdceca', line: 'rgba(248, 244, 236, 0.24)', focus: '#e7bb8e',
      'card-bg': 'rgba(12, 28, 37, 0.77)', 'input-bg': 'rgba(7, 22, 29, 0.75)', 'input-line': 'rgba(234, 241, 232, 0.48)',
      'input-placeholder': '#bbcdc7', 'button-bg': 'rgba(222, 235, 225, 0.09)', 'button-line': 'rgba(236, 241, 231, 0.44)',
      'button-hover': 'rgba(222, 235, 225, 0.17)', 'button-hover-line': 'rgba(236, 241, 231, 0.7)', icon: '#e8c7a4', message: '#f4c4a5',
    },
  };
  const mix = (a, b, amount) => a + (b - a) * amount;
  const number = (value) => String(Math.round(value * 10000) / 10000);
  function color(a, b, amount) {
    const channels = [1, 3, 5].map((offset) => number(mix(parseInt(a.slice(offset, offset + 2), 16), parseInt(b.slice(offset, offset + 2), 16), amount)));
    return `rgb(${channels.join(', ')})`;
  }
  const formatters = new Map();
  function formatter(timeZone) {
    if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 80) throw new RangeError('Choose a valid time zone.');
    if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
    return formatters.get(timeZone);
  }
  function getState(date = new Date(), timeZone = null) {
    if (!date || typeof date.getTime !== 'function' || !Number.isFinite(date.getTime())) throw new RangeError('A valid local date is required.');
    const parts = timeZone == null ? null : Object.fromEntries(formatter(timeZone).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    const hour = (parts ? parts.hour + parts.minute / 60 + parts.second / 3600 : date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600) + date.getMilliseconds() / 3600000;
    const index = frames.findIndex((frame, i) => i < frames.length - 1 && hour >= frame.hour && hour < frames[i + 1].hour);
    const from = frames[index], to = frames[index + 1];
    const position = (hour - from.hour) / (to.hour - from.hour);
    const amount = position * position * (3 - 2 * position);
    const mode = hour >= 7 && hour < 18 ? 'light' : 'dark';
    const variables = {};
    colorNames.forEach((name, i) => { variables[`--${name}`] = color(from.colors[i], to.colors[i], amount); });
    for (const [name, value] of Object.entries(ui[mode])) variables[`--${name}`] = value;
    variables['--daylight'] = number(mix(from.light, to.light, amount));
    for (const body of ['sun', 'moon']) {
      variables[`--${body}-x`] = `${number(mix(from[body][0], to[body][0], amount))}%`;
      variables[`--${body}-y`] = `${number(mix(from[body][1], to[body][1], amount))}%`;
      variables[`--${body}-opacity`] = number(mix(from[body][2], to[body][2], amount));
    }
    variables['--stars-opacity'] = number(mix(from.stars, to.stars, amount));
    variables['--glow-opacity'] = number(mix(from.glow, to.glow, amount));
    return { phase: from.phase, mode, variables };
  }

  if (typeof module === 'object' && module.exports) module.exports = { getState };
  if (!browser?.document || browser.CaseForgeScene) return;
  const document = browser.document;
  let timer = null, active = false, latest, selectedTimezone = null, weather = null;
  const conditions = new Set(['clear', 'cloudy', 'rain', 'snow', 'fog', 'storm']);
  const clamp = (value) => Math.max(0, Math.min(1, value));
  function applyWeather(state) {
    const condition = weather?.condition || 'unknown';
    const cloud = weather?.cloudCover || 0, precipitation = (weather?.precipitation || 0) / (weather?.precipitationHours || 1);
    const rain = condition === 'rain' || condition === 'storm' ? clamp(.25 + precipitation / 8) : 0;
    const snow = condition === 'snow' ? clamp(.25 + precipitation / 5) : 0;
    const fog = condition === 'fog' ? 1 : 0;
    Object.assign(state.variables, { '--weather-cloud': number(cloud), '--weather-rain': number(rain), '--weather-snow': number(snow), '--weather-fog': number(fog),
      '--weather-tint': `rgba(42, 61, 76, ${number(cloud * .2)})` });
    state.variables['--sun-opacity'] = number(Number(state.variables['--sun-opacity']) * (1 - cloud * .8) * (1 - fog * .7));
    state.variables['--moon-opacity'] = number(Number(state.variables['--moon-opacity']) * (1 - cloud * .7) * (1 - fog * .7));
    state.variables['--stars-opacity'] = number(Number(state.variables['--stars-opacity']) * (1 - cloud * .95));
    state.variables['--glow-opacity'] = number(Number(state.variables['--glow-opacity']) * (1 - cloud * .7));
    if (cloud) {
      const tint = state.mode === 'light' ? [120, 138, 148] : [38, 52, 65];
      for (const key of ['--sky-top', '--sky-mid', '--sky-horizon']) {
        const channels = state.variables[key].match(/[\d.]+/g).map(Number);
        state.variables[key] = `rgb(${channels.map((channel, i) => number(mix(channel, tint[i], cloud * .36))).join(', ')})`;
      }
    }
    return condition;
  }
  function updateLogo(mode) {
    const logo = document.querySelector('body > header img');
    const source = logo?.getAttribute('src') || '';
    // Only swap the known local brand asset; never rewrite an unrelated image.
    if (!/^(?:\.\/)?brand\/logo(?:-reversed)?\.svg$/.test(source)) return;
    const next = source.replace(/logo(?:-reversed)?\.svg$/, mode === 'light' ? 'logo.svg' : 'logo-reversed.svg');
    if (next !== source) logo.setAttribute('src', next);
  }
  function update(date = new Date()) {
    const state = getState(date, selectedTimezone), element = document.documentElement;
    element.dataset.weather = applyWeather(state);
    for (const [name, value] of Object.entries(state.variables)) element.style.setProperty(name, value);
    element.dataset.sceneMode = state.mode; element.dataset.scenePhase = state.phase;
    element.dataset.sceneReady = 'true';
    element.dataset.sceneHidden = document.visibilityState === 'hidden' ? 'true' : 'false';
    latest = state;
    if (document.readyState !== 'loading') updateLogo(state.mode);
    return state;
  }
  function refresh() { if (active) update(); }
  function visible() {
    document.documentElement.dataset.sceneHidden = document.visibilityState === 'hidden' ? 'true' : 'false';
    if (document.visibilityState !== 'hidden') refresh();
  }
  function start() {
    if (!active) {
      active = true;
      document.addEventListener('visibilitychange', visible);
      browser.addEventListener('focus', refresh);
    }
    update();
    if (timer === null) timer = browser.setInterval(visible, 30000);
  }
  function stop() {
    active = false;
    document.documentElement.dataset.sceneHidden = 'true';
    if (timer !== null) { browser.clearInterval(timer); timer = null; }
    document.removeEventListener('visibilitychange', visible);
    browser.removeEventListener('focus', refresh);
  }
  function setTimezone(timeZone) {
    if (timeZone != null) formatter(timeZone); // Validate before changing a working scene.
    selectedTimezone = timeZone == null ? null : timeZone;
    update(); return selectedTimezone;
  }
  function setWeather(snapshot) {
    weather = snapshot && !snapshot.unavailable && conditions.has(snapshot.condition)
      && typeof snapshot.cloudCover === 'number' && Number.isFinite(snapshot.cloudCover) && snapshot.cloudCover >= 0 && snapshot.cloudCover <= 1
      ? { condition: snapshot.condition, cloudCover: snapshot.cloudCover,
        precipitation: typeof snapshot.precipitation === 'number' && Number.isFinite(snapshot.precipitation) ? Math.max(0, Math.min(1000, snapshot.precipitation)) : 0,
        precipitationHours: [1, 6, 12].includes(snapshot.precipitationHours) ? snapshot.precipitationHours : 1 } : null;
    return update();
  }
  browser.CaseForgeScene = Object.freeze({ getState, update, setTimezone, getTimezone: () => selectedTimezone, setWeather });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { if (active && latest) updateLogo(latest.mode); }, { once: true });
  browser.addEventListener('pagehide', stop);
  browser.addEventListener('pageshow', start);
  start();
})(typeof window === 'object' ? window : null);
