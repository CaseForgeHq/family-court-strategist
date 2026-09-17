const { readFileSync, writeFileSync, renameSync, unlinkSync, statSync } = require('node:fs');
const { createHash } = require('node:crypto');
const document = require('./terms.js');
const version = document.version;
const documentHash = createHash('sha256').update(JSON.stringify(document)).digest('hex');

function createTermsAcceptance(path, now = () => new Date()) {
  function get() {
    try {
      if (statSync(path).size > 16384) throw new Error('Oversize receipt');
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      if (saved.schema === 1 && saved.version === version && saved.documentHash === documentHash &&
          typeof saved.acceptedAt === 'string' && Number.isFinite(Date.parse(saved.acceptedAt))) {
        return { version, documentHash, accepted: true, acceptedAt: saved.acceptedAt };
      }
    } catch { /* Missing, old or damaged receipts require a new explicit choice. */ }
    return { version, documentHash, accepted: false };
  }
  return {
    get,
    accept(value) {
      if (!value || value.accepted !== true || value.version !== version || value.documentHash !== documentHash) {
        throw new Error('Review and accept the current beta terms to continue.');
      }
      if (get().accepted) return get();
      const receipt = { schema: 1, version, documentHash, acceptedAt: now().toISOString() };
      writeFileSync(`${path}.tmp`, JSON.stringify(receipt), { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
      return get();
    },
    clear() {
      for (const file of [`${path}.tmp`, path]) {
        try { unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  };
}
module.exports = { createTermsAcceptance };
