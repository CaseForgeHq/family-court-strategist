const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve, sep } = require('node:path');
const { tmpdir } = require('node:os');
const { createWeatherService } = require('../weather.cjs');
const START = Date.UTC(2026, 8, 16, 12), MINUTE = 60000;
function cache(t) {
  const root = resolve(tmpdir()), folder = mkdtempSync(join(root, 'caseforge-weather-'));
  t.after(() => { assert.ok(resolve(folder).startsWith(root + sep + 'caseforge-weather-')); rmSync(folder, { recursive: true, force: true }); });
  return join(folder, 'weather.json');
}
function forecast(time = START, symbol = 'clearsky_day', extra = {}) {
  return { properties: { meta: { units: { air_temperature: 'celsius', cloud_area_fraction: '%', precipitation_amount: 'mm' } },
    timeseries: [{ time: new Date(time).toISOString(), data: { instant: { details: { air_temperature: 24.5, cloud_area_fraction: 35, ...extra } },
      next_1_hours: { summary: { symbol_code: symbol }, details: { precipitation_amount: 1.2 } } } }] } };
}
const response = (payload = forecast(), headers = {}) => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json', ...headers } });

test('only catalog city IDs are accepted and location copies cannot rewrite destinations', async () => {
  let requests = 0;
  const service = createWeatherService({ fetchImpl: async () => { requests++; return response(); }, now: () => START });
  const locations = service.listLocations();
  assert.equal(locations.length, 10);
  for (const place of locations) {
    assert.ok(place.latitude >= -90 && place.latitude <= 90 && place.longitude >= -180 && place.longitude <= 180);
    assert.equal(Math.round(place.latitude * 100) / 100, place.latitude);
    assert.equal(Math.round(place.longitude * 100) / 100, place.longitude);
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: place.timeZone }));
  }
  locations[0].id = 'https://example.com'; locations[0].latitude = 0;
  assert.equal(service.listLocations()[0].id, 'perth');
  for (const invalid of ['https://example.com', '../config.json', '__proto__', 'Perth', '', null, { id: 'perth' }]) await assert.rejects(service.get(invalid), /supported weather city/);
  assert.equal(requests, 0);
});

test('forecast measurements, precipitation periods, known symbols and attribution are normalized', async () => {
  for (const [symbol, condition] of [['clearsky_day', 'clear'], ['fair_night', 'clear'], ['partlycloudy_day', 'cloudy'], ['rainshowers_day', 'rain'], ['heavysleet', 'snow'], ['lightssnowshowersandthunder_day', 'storm'], ['heavyrainandthunder', 'storm'], ['rainshowersandthunder_night', 'storm'], ['lightrainandthunder', 'storm'], ['fog', 'fog']]) {
    const payload = forecast(START, symbol);
    if (symbol === 'fog') { payload.properties.timeseries[0].data.next_6_hours = payload.properties.timeseries[0].data.next_1_hours; delete payload.properties.timeseries[0].data.next_1_hours; }
    const result = await createWeatherService({ fetchImpl: async () => response(payload), now: () => START }).get('brisbane');
    assert.equal(result.condition, condition); assert.equal(result.temperature, 24.5); assert.equal(result.cloudCover, .35);
    assert.equal(result.precipitation, 1.2); assert.equal(result.precipitationHours, symbol === 'fog' ? 6 : 1);
    assert.equal(result.timeZone, 'Australia/Brisbane'); assert.equal(result.forecastAt, new Date(START).toISOString());
    assert.equal(result.fetchedAt, new Date(START).toISOString()); assert.equal(result.stale, false);
    assert.equal(result.source, 'MET Norway'); assert.match(result.sourceUrl, /^https:\/\/api\.met\.no\//);
    assert.equal(result.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
  }
});

test('same-city requests coalesce; Expires cache persists and conditional 304 extends it', async (t) => {
  const cachePath = cache(t), calls = []; let time = START, release;
  const modified = new Date(START - 30 * MINUTE).toUTCString();
  const service = createWeatherService({ cachePath, now: () => time, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) { await new Promise((done) => { release = done; }); return response(forecast(), { expires: new Date(START + 120 * MINUTE).toUTCString(), 'last-modified': modified }); }
    return new Response(null, { status: 304, headers: { expires: new Date(time + 45 * MINUTE).toUTCString() } });
  } });
  const one = service.get('perth'), two = service.get('perth');
  await new Promise(setImmediate); assert.equal(calls.length, 1); release();
  const [a, b] = await Promise.all([one, two]); assert.deepEqual(a, b);
  assert.match(calls[0].url, /^https:\/\/api\.met\.no\/weatherapi\/locationforecast\/2\.0\/compact\?lat=-31\.95&lon=115\.86$/);
  assert.equal(calls[0].options.headers['User-Agent'], 'CaseForge/0.4.0 https://github.com/CaseForgeHq/family-court-strategist');
  assert.equal(calls[0].options.headers['If-Modified-Since'], undefined);
  a.temperature = 999; assert.equal((await service.get('perth')).temperature, 24.5); assert.equal(calls.length, 1);
  const restart = createWeatherService({ cachePath, now: () => time, fetchImpl: async () => assert.fail('Fresh persisted cache must not fetch') });
  assert.equal((await restart.get('perth')).temperature, 24.5);
  time += 121 * MINUTE;
  const revalidated = await service.get('perth');
  assert.equal(calls.length, 2); assert.equal(calls[1].options.headers['If-Modified-Since'], modified);
  assert.equal(revalidated.fetchedAt, new Date(time).toISOString()); assert.equal(revalidated.stale, false);
  await service.get('perth'); assert.equal(calls.length, 2);
  assert.equal(JSON.parse(readFileSync(cachePath, 'utf8')).entries.perth.expiresAt, time + 45 * MINUTE);
});

test('429 and 403 globally back off queued cities and persist Retry-After across restart', async (t) => {
  for (const [status, retry, delay] of [[429, '3600', 60], [403, new Date(START + 45 * MINUTE).toUTCString(), 45], [429, '1', 30]]) {
    const cachePath = cache(t); let time = START, requests = 0;
    const fetchImpl = async () => { requests++; return requests === 1 ? new Response(null, { status, headers: { 'retry-after': retry } }) : response(forecast(time)); };
    const service = createWeatherService({ cachePath, now: () => time, fetchImpl });
    const results = await Promise.all([service.get('sydney'), service.get('tokyo')]);
    assert.equal(requests, 1); assert.ok(results.every((result) => result.unavailable && result.condition === 'unknown'));
    const restart = createWeatherService({ cachePath, now: () => time, fetchImpl });
    time += (delay - 1) * MINUTE; await restart.get('london'); assert.equal(requests, 1);
    time += 2 * MINUTE; assert.equal((await restart.get('london')).stale, false); assert.equal(requests, 2);
  }
});

test('errors retain a stale cached forecast and briefly suppress repeated failed requests', async () => {
  let time = START, requests = 0;
  const service = createWeatherService({ now: () => time, fetchImpl: async () => {
    requests++; if (requests === 2) throw new Error('offline');
    return response(forecast(time, 'rain'), { expires: new Date(time + 10 * MINUTE).toUTCString() });
  } });
  const initial = await service.get('london'); time += 11 * MINUTE;
  const stale = await service.get('london');
  assert.deepEqual(stale, { ...initial, stale: true }); assert.equal(stale.condition, 'rain');
  await service.get('london'); assert.equal(requests, 2);
  time += 11 * MINUTE; assert.equal((await service.get('london')).stale, false); assert.equal(requests, 3);
});

test('malformed, oversized, unknown and missing measurements never become clear weather', async () => {
  const missing = forecast(); delete missing.properties.timeseries[0].data.instant.details.air_temperature;
  const wrongUnits = forecast(); wrongUnits.properties.meta.units.air_temperature = 'fahrenheit';
  for (const make of [() => response(missing), () => response(wrongUnits), () => response(forecast(START, 'alienweather')),
    () => response(forecast(START, 'cloudy', { cloud_area_fraction: 101 })), () => response(forecast(START - 24 * 60 * MINUTE)),
    () => new Response('{broken'), () => new Response('{}', { headers: { 'content-length': String(2 * 1024 * 1024) } }),
    () => new Response('x'.repeat(1024 * 1024 + 1)), () => new Response(null, { status: 503 }), () => new Response(null, { status: 304 })]) {
    const result = await createWeatherService({ now: () => START, fetchImpl: async () => make() }).get('auckland');
    assert.equal(result.unavailable, true); assert.equal(result.condition, 'unknown'); assert.equal(result.temperature, null); assert.equal(result.cloudCover, null);
  }
});

test('eight-second request timeout aborts the fetch and returns unavailable', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let signal;
  const service = createWeatherService({ now: () => START, fetchImpl: async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const pending = service.get('new-york'); await Promise.resolve(); await Promise.resolve();
  assert.equal(signal.aborted, false); t.mock.timers.tick(7999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); assert.equal(signal.aborted, true);
  assert.equal((await pending).condition, 'unknown');
});

test('redirects stay on the MET forecast endpoint and damaged caches are ignored', async (t) => {
  const cachePath = cache(t); writeFileSync(cachePath, '{broken'); let requests = 0;
  const service = createWeatherService({ cachePath, now: () => START, fetchImpl: async () => {
    requests++; return requests === 1 ? new Response(null, { status: 302, headers: { location: '/weatherapi/locationforecast/2.0/compact?lat=51.51&lon=-0.13' } }) : response();
  } });
  assert.equal((await service.get('london')).stale, false); assert.equal(requests, 2);
  let unsafeCalls = 0;
  const unsafe = createWeatherService({ now: () => START, fetchImpl: async () => { unsafeCalls++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }); } });
  assert.equal((await unsafe.get('tokyo')).condition, 'unknown'); assert.equal(unsafeCalls, 1);
});
