const { readFileSync, statSync, writeFileSync, mkdirSync, renameSync } = require('node:fs');
const { dirname } = require('node:path');

const SOURCE_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/documentation';
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
const ENDPOINT = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const USER_AGENT = 'CaseForge/0.4.0 https://github.com/CaseForgeHq/family-court-strategist';
const MINUTE = 60000, MAX_BODY = 1024 * 1024, MAX_CACHE = 65536;
const LOCATIONS = Object.freeze([
  ['perth', 'Perth', 'Australia/Perth', -31.95, 115.86],
  ['brisbane', 'Brisbane', 'Australia/Brisbane', -27.47, 153.03],
  ['sydney', 'Sydney', 'Australia/Sydney', -33.87, 151.21],
  ['adelaide', 'Adelaide', 'Australia/Adelaide', -34.93, 138.60],
  ['darwin', 'Darwin', 'Australia/Darwin', -12.46, 130.84],
  ['tokyo', 'Tokyo', 'Asia/Tokyo', 35.68, 139.69],
  ['london', 'London', 'Europe/London', 51.51, -.13],
  ['new-york', 'New York', 'America/New_York', 40.71, -74.01],
  ['los-angeles', 'Los Angeles', 'America/Los_Angeles', 34.05, -118.24],
  ['auckland', 'Auckland', 'Pacific/Auckland', -36.85, 174.76],
].map(([id, label, timeZone, latitude, longitude]) => Object.freeze({ id, label, timeZone, latitude, longitude })));
const catalog = new Map(LOCATIONS.map((location) => [location.id, location]));
const summaries = Object.freeze({ clear: 'Clear sky', cloudy: 'Cloudy', rain: 'Rain', snow: 'Snow or sleet', fog: 'Fog', storm: 'Thunderstorms' });
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const metadata = (location) => ({ cityId: location.id, label: location.label, timeZone: location.timeZone, source: 'MET Norway', sourceUrl: SOURCE_URL, licenseUrl: LICENSE_URL });

function conditionFor(symbol) {
  if (typeof symbol !== 'string' || symbol.length > 80) throw new Error('Missing weather symbol.');
  const base = symbol.replace(/_(day|night|polartwilight)$/, '');
  if (!/^(clearsky|fair|partlycloudy|cloudy|fog|(?:light|heavy|lights)?(?:rain|sleet|snow)(?:showers)?(?:andthunder)?)$/.test(base)) throw new Error('Unknown weather symbol.');
  if (base.includes('thunder')) return 'storm';
  if (/snow|sleet/.test(base)) return 'snow';
  if (base.includes('rain')) return 'rain';
  if (base === 'fog') return 'fog';
  return /cloudy/.test(base) ? 'cloudy' : 'clear';
}
function parseForecast(payload, location, time) {
  const series = payload?.properties?.timeseries;
  if (!Array.isArray(series) || series.length === 0 || series.length > 300) throw new Error('Invalid forecast series.');
  const candidates = series.filter((entry) => validDate(entry?.time) && Math.abs(Date.parse(entry.time) - time) <= 3 * 60 * MINUTE);
  candidates.sort((a, b) => Math.abs(Date.parse(a.time) - time) - Math.abs(Date.parse(b.time) - time));
  const entry = candidates[0], details = entry?.data?.instant?.details;
  const interval = [1, 6, 12].find((hours) => entry?.data?.[`next_${hours}_hours`]?.summary?.symbol_code);
  const period = entry?.data?.[`next_${interval}_hours`];
  const temperature = details?.air_temperature, cloud = details?.cloud_area_fraction;
  const precipitation = period?.details?.precipitation_amount;
  if (!finite(temperature, -100, 70) || !finite(cloud, 0, 100) || !finite(precipitation, 0, 1000)) throw new Error('Invalid forecast measurements.');
  const units = payload?.properties?.meta?.units;
  if (units && (units.air_temperature !== 'celsius' || units.cloud_area_fraction !== '%' || units.precipitation_amount !== 'mm')) throw new Error('Unexpected forecast units.');
  const condition = conditionFor(period.summary.symbol_code);
  return { ...metadata(location), temperature, cloudCover: cloud / 100, precipitation, precipitationHours: interval,
    condition, summary: summaries[condition], forecastAt: new Date(entry.time).toISOString(), fetchedAt: new Date(time).toISOString(), stale: false };
}
function cleanSnapshot(snapshot, location) {
  if (!snapshot || !finite(snapshot.temperature, -100, 70) || !finite(snapshot.cloudCover, 0, 1) || !finite(snapshot.precipitation, 0, 1000)
    || !Object.hasOwn(summaries, snapshot.condition) || !validDate(snapshot.forecastAt) || !validDate(snapshot.fetchedAt)
    || ![1, 6, 12].includes(snapshot.precipitationHours)) return null;
  return { ...metadata(location), temperature: snapshot.temperature, cloudCover: snapshot.cloudCover, precipitation: snapshot.precipitation,
    precipitationHours: snapshot.precipitationHours, condition: snapshot.condition, summary: summaries[snapshot.condition],
    forecastAt: snapshot.forecastAt, fetchedAt: snapshot.fetchedAt, stale: false };
}
async function readBody(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) throw new Error('Weather response is too large.');
  if (!response.body?.getReader) throw new Error('Weather response has no readable body.');
  const reader = response.body.getReader(), parts = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY) { await reader.cancel(); throw new Error('Weather response is too large.'); }
      parts.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(parts, length).toString('utf8'));
}
function expiry(headers, time) {
  const expires = Date.parse(headers.get('expires'));
  const maxAge = headers.get('cache-control')?.match(/(?:^|,)\s*max-age=(\d+)/i);
  return Math.max(time + 10 * MINUTE, Number.isFinite(expires) ? expires : maxAge ? time + Number(maxAge[1]) * 1000 : time + 30 * MINUTE);
}
function retryTime(value, time) {
  const seconds = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  const date = Date.parse(value);
  return Math.max(time + 30 * MINUTE, Number.isFinite(seconds) ? time + seconds * 1000 : Number.isFinite(date) ? date : 0);
}

function createWeatherService({ cachePath, fetchImpl = fetch, now = Date.now } = {}) {
  if (cachePath != null && (typeof cachePath !== 'string' || !cachePath)) throw new TypeError('Invalid weather cache path.');
  if (typeof fetchImpl !== 'function' || typeof now !== 'function') throw new TypeError('Invalid weather service dependency.');
  const entries = new Map(), inFlight = new Map();
  let backoffUntil = 0, queue = Promise.resolve();
  // This file contains public weather summaries only. Ignore damaged or oversized caches.
  if (cachePath) {
    try {
      if (statSync(cachePath).size <= MAX_CACHE) {
        const saved = JSON.parse(readFileSync(cachePath, 'utf8'));
        if (saved.version === 1) {
          if (finite(saved.backoffUntil, 0, 8640000000000000)) backoffUntil = saved.backoffUntil;
          for (const location of LOCATIONS) {
            const entry = saved.entries?.[location.id];
            if (!entry || !finite(entry.expiresAt, 0, 8640000000000000) || !finite(entry.retryAt, 0, 8640000000000000)) continue;
            const snapshot = cleanSnapshot(entry.snapshot, location);
            entries.set(location.id, { snapshot, expiresAt: entry.expiresAt, retryAt: entry.retryAt,
              lastModified: validDate(entry.lastModified) && Date.parse(entry.lastModified) <= now() ? entry.lastModified : null });
          }
        }
      }
    } catch { /* An unavailable cache does not prevent an explicitly requested forecast. */ }
  }
  function persist() {
    if (!cachePath) return;
    try {
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(`${cachePath}.tmp`, JSON.stringify({ version: 1, backoffUntil, entries: Object.fromEntries(entries) }), { mode: 0o600 });
      renameSync(`${cachePath}.tmp`, cachePath);
    } catch { /* Continue with the in-memory public weather cache. */ }
  }
  function fallback(location, entry, time) {
    if (entry?.snapshot) return { ...entry.snapshot, stale: true };
    return { ...metadata(location), temperature: null, cloudCover: null, precipitation: null, precipitationHours: null,
      condition: 'unknown', summary: 'Weather is unavailable.', forecastAt: null, fetchedAt: null, stale: true, unavailable: true };
  }
  async function request(location) {
    const time = now();
    let entry = entries.get(location.id);
    if (entry?.snapshot && time < entry.expiresAt) return { ...entry.snapshot, stale: Math.abs(time - Date.parse(entry.snapshot.forecastAt)) > 3 * 60 * MINUTE };
    if (time < backoffUntil || time < (entry?.retryAt || 0)) return fallback(location, entry, time);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Weather request timed out.')), 8000);
    try {
      const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
      if (entry?.lastModified) headers['If-Modified-Since'] = entry.lastModified;
      let url = `${ENDPOINT}?lat=${location.latitude.toFixed(2)}&lon=${location.longitude.toFixed(2)}`, response;
      for (let redirect = 0; redirect <= 3; redirect++) {
        response = await fetchImpl(url, { headers, signal: controller.signal, redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const next = new URL(response.headers.get('location'), url);
        await response.body?.cancel();
        if (redirect === 3 || next.origin !== 'https://api.met.no' || !next.pathname.startsWith('/weatherapi/locationforecast/2.0/')) throw new Error('Unexpected weather redirect.');
        url = next.href;
      }
      const fetched = now();
      if ([403, 429].includes(response.status)) {
        backoffUntil = retryTime(response.headers.get('retry-after'), fetched);
        await response.body?.cancel(); persist(); return fallback(location, entry, fetched);
      }
      if (response.status === 304 && entry?.snapshot) {
        entry.expiresAt = expiry(response.headers, fetched); entry.retryAt = 0;
        entry.snapshot = { ...entry.snapshot, fetchedAt: new Date(fetched).toISOString() };
        persist(); return { ...entry.snapshot, stale: Math.abs(fetched - Date.parse(entry.snapshot.forecastAt)) > 3 * 60 * MINUTE };
      }
      if (![200, 203].includes(response.status)) { await response.body?.cancel(); throw new Error('Weather service is unavailable.'); }
      const snapshot = parseForecast(await readBody(response), location, fetched);
      const modified = response.headers.get('last-modified');
      entry = { snapshot, expiresAt: expiry(response.headers, fetched), retryAt: 0,
        lastModified: validDate(modified) && Date.parse(modified) <= fetched ? modified : null };
      entries.set(location.id, entry); persist(); return { ...snapshot };
    } catch {
      entry = entries.get(location.id) || { snapshot: null, expiresAt: 0, lastModified: null, retryAt: 0 };
      entry.retryAt = now() + 10 * MINUTE; entries.set(location.id, entry); persist();
      return fallback(location, entry, now());
    } finally { clearTimeout(timer); }
  }
  async function get(cityId) {
    if (typeof cityId !== 'string' || !catalog.has(cityId)) throw new TypeError('Choose a supported weather city.');
    if (inFlight.has(cityId)) return { ...await inFlight.get(cityId) };
    // Serialize different cities so a rate-limit response immediately gates later requests.
    const task = queue.then(() => request(catalog.get(cityId)));
    queue = task.then(() => {}, () => {}); inFlight.set(cityId, task);
    try { return { ...await task }; } finally { inFlight.delete(cityId); }
  }
  return Object.freeze({ get, listLocations: () => LOCATIONS.map((location) => ({ ...location })) });
}

module.exports = { createWeatherService };
