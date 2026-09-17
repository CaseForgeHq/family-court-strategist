const { readFileSync, writeFileSync, renameSync } = require('node:fs');

function createScenePreferences(path, locations) {
  const validIds = new Set(locations.map((location) => location.id));
  const defaults = { cityId: 'brisbane', weatherEnabled: true };
  function validate(value) {
    if (!value || !validIds.has(value.cityId) || typeof value.weatherEnabled !== 'boolean') throw new Error('Choose a listed city and a weather setting.');
    return { cityId: value.cityId, weatherEnabled: value.weatherEnabled };
  }
  function get() {
    try { return validate(JSON.parse(readFileSync(path, 'utf8'))); } catch { return { ...defaults }; }
  }
  return {
    get,
    set(value) {
      const next = validate(value);
      writeFileSync(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
      return next;
    },
  };
}
module.exports = { createScenePreferences };
