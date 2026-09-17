(() => {
  const host = document.getElementById('scene-controls'), bridge = window.strategistDesktop, scene = window.CaseForgeScene;
  if (!host || !scene) return;
  const workspace = host.classList.contains('workspace-atmosphere');
  const glyphs = {
    settings: '<path d="M3 7h4m4 0h10M3 17h10m4 0h4"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
    clear: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2m-3-7 1.5-1.5M5.5 18.5 7 17m10 0 1.5 1.5M5.5 5.5 7 7"/>',
    moon: '<path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/>',
    cloudy: '<path d="M7 18a5 5 0 1 1 .6-9.96 6 6 0 0 1 11.6 2.1A4 4 0 0 1 19 18Z"/>',
    rain: '<path d="M5 14a4 4 0 0 1 1.6-7.7 5 5 0 0 1 9.6 1.8A3 3 0 1 1 19 14M8 16l-1 4M13 16l-1 4M18 16l-1 4"/>',
    snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M4 10l4-1-1-4M17 19l-1-4 4-1M4 14l4 1-1 4M17 5l-1 4 4 1"/>',
    storm: '<path d="M5 14a4 4 0 0 1 1.6-7.7 5 5 0 0 1 9.6 1.8A3 3 0 1 1 19 14M13 11l-4 6h5l-3 5"/>',
    fog: '<path d="M5 12a4 4 0 0 1 1.6-7.7 5 5 0 0 1 9.6 1.8A3 3 0 1 1 19 12M3 16h18M6 20h12"/>',
  };
  const glyph = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name] || glyphs.cloudy}</svg>`;
  const tile = workspace ? `<span class="scene-widget-top"><span id="scene-widget-city">Your time</span><span class="scene-widget-open">${glyph('chevron')}</span></span><span class="scene-widget-main"><time id="scene-widget-time">—</time><span class="scene-widget-weather"><span id="scene-widget-icon">${glyph('cloudy')}</span><span id="scene-widget-temperature">—</span></span></span><span class="scene-widget-bottom"><span id="scene-widget-date"></span><span id="scene-widget-summary">Weather</span></span><span class="sr-only">Open clock, weather and world clocks</span>`
    : `${glyph('settings')}<span>Weather &amp; scene</span><span class="scene-tab-chevron" aria-hidden="true">⌃</span>`;
  host.innerHTML = `<button id="scene-toggle" class="scene-tab${workspace ? ' scene-widget' : ''}" type="button" aria-expanded="false" aria-controls="scene-panel">${tile}</button>
    <section id="scene-panel" class="scene-panel" aria-labelledby="scene-panel-title" hidden><div class="scene-panel-heading"><h2 id="scene-panel-title">${workspace ? 'Your day' : 'Weather &amp; scene'}</h2><button id="scene-close" type="button" aria-label="Close weather and scene">${workspace ? glyph('close') : '×'}</button></div>
    ${workspace ? '<section class="world-clocks" aria-labelledby="world-clocks-title"><h3 id="world-clocks-title">World clocks</h3><div id="scene-world-clocks"></div></section>' : ''}
    <div class="scene-control-head"><span class="scene-control-title">Your atmosphere</span><label class="weather-switch"><input id="scene-weather-toggle" type="checkbox" checked><span>City weather</span></label></div>
    <div class="scene-city-row"><label id="scene-city-label" for="scene-timezone">Brisbane</label><span id="scene-clock"></span></div>
    <input id="scene-timezone" type="range" min="0" max="9" step="1" value="7" aria-label="Scene timezone">
    <div class="scene-weather-row"><span id="scene-weather-status" role="status">Connecting to city weather…</span><span id="scene-zone"></span></div>
    <p class="weather-credit"><a href="https://www.met.no/en" data-scene-link="source">MET Norway</a> · <a href="https://creativecommons.org/licenses/by/4.0/" data-scene-link="license">CC BY 4.0</a><span>Weather uses city coordinates and your IP. Case files stay out of weather requests.</span></p></section>`;
  const $ = (id) => document.getElementById(id);
  const panel = $('scene-panel'), tab = $('scene-toggle');
  function setPanel(open, restoreFocus = false) {
    panel.hidden = !open;
    tab.setAttribute('aria-expanded', String(open));
    if (open) $('scene-close').focus({ preventScroll: true });
    else if (restoreFocus) tab.focus({ preventScroll: true });
  }
  tab.addEventListener('click', () => setPanel(panel.hidden));
  $('scene-close').addEventListener('click', () => setPanel(false, true));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); setPanel(false, true); }
  });
  const closeOutside = (event) => { if (!panel.hidden && !host.contains(event.target)) setPanel(false); };
  document.addEventListener('pointerdown', closeOutside);
  document.addEventListener('click', closeOutside);
  window.addEventListener('caseforge:stage', () => setPanel(false, panel.contains(document.activeElement)));
  window.addEventListener('caseforge:view', () => setPanel(false, panel.contains(document.activeElement)));
  const order = ['los-angeles', 'new-york', 'london', 'perth', 'tokyo', 'adelaide', 'darwin', 'brisbane', 'sydney', 'auckland'];
  let locations = [], city, enabled = true, timer, refreshTimer, revision = 0, lifecycle = 0, stopped = false, saveQueue = Promise.resolve();
  let snapshot = null, weatherState = 'loading', nextForecast = 0, clockTick = '';
  const formats = new Map();
  const format = (zone, options) => {
    const key = zone + JSON.stringify(options);
    if (!formats.has(key)) formats.set(key, new Intl.DateTimeFormat('en-AU', { timeZone: zone, ...options }));
    return formats.get(key);
  };
  function text(id, value) { const el = $(id); if (el && el.textContent !== value) el.textContent = value; }
  function renderWeather() {
    if (!workspace) return;
    const available = weatherState === 'ready' && snapshot;
    text('scene-widget-temperature', available ? `${Math.round(snapshot.temperature)}°` : '—');
    text('scene-widget-summary', available ? snapshot.stale ? 'Saved forecast' : snapshot.summary : weatherState === 'off' ? 'Weather off' : weatherState === 'loading' ? 'Loading…' : 'Unavailable');
    const condition = available ? snapshot.condition === 'clear' && document.documentElement.dataset.sceneMode === 'dark' ? 'moon' : snapshot.condition : 'cloudy';
    if ($('scene-widget-icon').dataset.condition !== condition) { $('scene-widget-icon').innerHTML = glyph(condition); $('scene-widget-icon').dataset.condition = condition; }
    host.querySelector('.scene-widget-weather').title = status.textContent;
  }
  function renderWorldClocks() {
    if (!workspace) return;
    const list = $('scene-world-clocks'); list.replaceChildren();
    for (const id of ['sydney', 'london', 'new-york', 'perth', 'los-angeles']) {
      const location = locations.find(item => item.id === id && item.id !== city?.id);
      if (!location || list.children.length >= 3) continue;
      const row = document.createElement('div'); row.className = 'world-clock'; row.dataset.zone = location.timeZone;
      row.innerHTML = '<div><strong></strong><span class="world-clock-offset"></span></div><div><time></time><span class="world-clock-day"></span></div>';
      row.querySelector('strong').textContent = location.label;
      list.append(row);
    }
  }
  function dateNumber(date, zone) {
    const parts = format(zone, { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
    const part = name => Number(parts.find(item => item.type === name).value);
    return Date.UTC(part('year'), part('month') - 1, part('day')) / 86400000;
  }
  function widgetClock(now) {
    if (!workspace) return;
    const zone = city?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    text('scene-widget-city', city?.label || 'Local time');
    text('scene-widget-time', format(zone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now));
    $('scene-widget-time').dateTime = now.toISOString();
    text('scene-widget-date', format(zone, { weekday: 'short', day: 'numeric', month: 'short' }).format(now));
    for (const row of host.querySelectorAll('.world-clock')) {
      row.querySelector('time').textContent = format(row.dataset.zone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
      row.querySelector('time').dateTime = now.toISOString();
      row.querySelector('.world-clock-offset').textContent = format(row.dataset.zone, { timeZoneName: 'shortOffset' }).formatToParts(now).find(part => part.type === 'timeZoneName').value.replace('GMT', 'UTC');
      const day = dateNumber(now, row.dataset.zone) - dateNumber(now, zone);
      row.querySelector('.world-clock-day').textContent = day === 0 ? 'Today' : day < 0 ? 'Yesterday' : 'Tomorrow';
    }
    renderWeather();
  }
  const slider = $('scene-timezone'), toggle = $('scene-weather-toggle'), status = $('scene-weather-status');
  slider.disabled = toggle.disabled = true;
  function clock() {
    if (document.visibilityState === 'hidden') return;
    const now = new Date(), tick = `${Math.floor(now.getTime() / 60000)}:${revision}`;
    if (clockTick === tick) return;
    clockTick = tick; widgetClock(now);
    if (!city) return;
    $('scene-clock').textContent = new Intl.DateTimeFormat('en-AU', { timeZone: city.timeZone, hour: '2-digit', minute: '2-digit', ...(workspace ? { hourCycle: 'h23' } : {}) }).format(now);
    const offset = new Intl.DateTimeFormat('en', { timeZone: city.timeZone, timeZoneName: 'shortOffset' }).formatToParts(now).find((part) => part.type === 'timeZoneName')?.value || '';
    $('scene-zone').textContent = workspace ? offset.replace('GMT', 'UTC') : offset;
  }
  function select(index) {
    city = locations[index]; if (!city) return;
    revision++; snapshot = null; weatherState = enabled ? 'loading' : 'off'; scene.setWeather(null); scene.setTimezone(city.timeZone);
    $('scene-city-label').textContent = city.label;
    slider.setAttribute('aria-valuetext', `${city.label}, ${city.timeZone.replaceAll('_', ' ')}`);
    slider.style.setProperty('--scene-range-progress', `${index / Math.max(1, locations.length - 1) * 100}%`);
    status.textContent = enabled ? 'Loading city forecast…' : 'Weather off · time of day only';
    status.title = '';
    renderWorldClocks(); clock();
  }
  async function forecast() {
    if (!city || !enabled || stopped || document.visibilityState === 'hidden') return;
    const request = revision, id = city.id;
    try {
      const value = await bridge.getSceneWeather(id);
      if (request !== revision || stopped || !enabled) return;
      if (!value || value.error || value.unavailable || value.disabled) {
        snapshot = null; weatherState = 'unavailable'; scene.setWeather(null); status.textContent = 'Forecast unavailable · time of day only'; renderWeather(); return;
      }
      scene.setWeather(value);
      status.textContent = `${Math.round(value.temperature)}° · ${value.summary}${value.stale ? ' · saved forecast' : ''}`;
      status.title = `${value.stale ? 'Last downloaded' : 'Updated'} ${new Date(value.fetchedAt).toLocaleString('en-AU', { timeZone: city.timeZone })}`;
      snapshot = value; weatherState = 'ready'; renderWeather();
    } catch {
      if (request === revision) { snapshot = null; weatherState = 'unavailable'; scene.setWeather(null); status.textContent = 'Forecast unavailable · time of day only'; renderWeather(); }
    }
  }
  function save() {
    const value = { cityId: city.id, weatherEnabled: enabled }, request = revision;
    // Serialize rapid changes so an older preference cannot overwrite the latest city.
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      const result = await bridge.setScenePreferences(value);
      if (request !== revision || stopped) return;
      if (result?.error) { status.textContent = 'Could not save this atmosphere. Try again.'; return; }
      await forecast();
    }).catch(() => { if (request === revision) status.textContent = 'Could not save this atmosphere. Try again.'; });
  }
  slider.addEventListener('input', () => {
    select(Number(slider.value)); clearTimeout(timer);
    timer = setTimeout(save, 450);
  });
  slider.addEventListener('change', () => { clearTimeout(timer); save(); });
  toggle.addEventListener('change', () => { enabled = toggle.checked; select(Number(slider.value)); clearTimeout(timer); save(); });
  for (const link of host.querySelectorAll('[data-scene-link]')) link.addEventListener('click', (event) => { event.preventDefault(); void bridge?.openSceneLink?.(link.dataset.sceneLink); });
  async function start() {
    const run = ++lifecycle;
    stopped = false; clearInterval(refreshTimer);
    if (!bridge?.getScenePreferences) { status.textContent = 'Atmosphere controls are available in the desktop app.'; weatherState = 'unavailable'; clock(); if (workspace) refreshTimer = setInterval(clock, 1000); return; }
    try {
      const prefs = await bridge.getScenePreferences();
      if (stopped || run !== lifecycle) return;
      if (prefs?.error || !Array.isArray(prefs?.locations)) throw new Error('Unavailable');
      locations = order.map((id) => prefs.locations.find((item) => item.id === id)).filter(Boolean);
      if (!locations.length) throw new Error('Unavailable');
      enabled = prefs.weatherEnabled; toggle.checked = enabled;
      slider.max = String(locations.length - 1);
      slider.value = String(Math.max(0, locations.findIndex((item) => item.id === prefs.cityId)));
      slider.disabled = toggle.disabled = false; select(Number(slider.value));
      await forecast();
      if (!stopped && run === lifecycle) {
        nextForecast = Date.now() + 60000;
        refreshTimer = setInterval(() => { clock(); if (!workspace || Date.now() >= nextForecast) { nextForecast = Date.now() + 60000; void forecast(); } }, workspace ? 1000 : 60000);
      }
    } catch { if (!stopped && run === lifecycle) { status.textContent = 'Atmosphere settings are unavailable.'; weatherState = 'unavailable'; clock(); if (workspace) refreshTimer = setInterval(clock, 1000); } }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') { clock(); void forecast(); } });
  window.addEventListener('pagehide', () => { stopped = true; revision++; lifecycle++; clearTimeout(timer); clearInterval(refreshTimer); });
  window.addEventListener('pageshow', () => { if (stopped) void start(); });
  void start();
})();
