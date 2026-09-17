const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } = require('node:fs');
const { dirname } = require('node:path');

// This verifier gates application access. It does not encrypt the portable vault.
class PinSecurity {
  constructor(path, { now = Date.now } = {}) { this.path = path; this.now = now; }
  read() {
    if (!existsSync(this.path)) return null;
    const value = JSON.parse(readFileSync(this.path, 'utf8'));
    if (value.version !== 1 || !/^[a-f0-9]{32}$/.test(value.salt) || !/^[a-f0-9]{64}$/.test(value.hash)
      || !Number.isSafeInteger(value.failures) || value.failures < 0 || !Number.isFinite(value.retryAt)) {
      throw new Error('The app lock settings could not be read. Your case files have not been changed.');
    }
    return value;
  }
  write(value) {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
    renameSync(temp, this.path);
  }
  status() {
    const value = this.read();
    return { configured: !!value, retryAfter: value ? Math.max(0, Math.ceil((value.retryAt - this.now()) / 1000)) : 0 };
  }
  derive(pin, salt) { return scryptSync(pin, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); }
  setup(pin, confirmation) {
    if (this.read()) throw new Error('A PIN is already set. Unlock with your existing PIN.');
    return this.replace(pin, confirmation);
  }
  replace(pin, confirmation) {
    if (typeof pin !== 'string' || !/^\d{6,12}$/.test(pin)) throw new Error('Choose a PIN with 6 to 12 digits.');
    if (pin !== confirmation) throw new Error('Those PINs do not match. Please try again.');
    if (/^(\d)\1+$/.test(pin) || ['123456', '654321', '12345678', '012345'].includes(pin)) throw new Error('Choose a less predictable PIN. Avoid repeated digits or a simple sequence.');
    const salt = randomBytes(16).toString('hex');
    this.write({ version: 1, salt, hash: this.derive(pin, salt).toString('hex'), failures: 0, retryAt: 0 });
    return true;
  }
  change(currentPin, pin, confirmation) {
    this.verify(currentPin);
    return this.replace(pin, confirmation);
  }
  reset(currentPin, beforeRemove = () => {}) {
    this.verify(currentPin);
    return this.clearSetup(beforeRemove);
  }
  // Called without a PIN only after the main process obtains explicit native
  // confirmation to discard setup. Never restores access to the previous case.
  clearSetup(beforeRemove) {
    // Forget the case location before removing its app lock. If writing settings
    // fails, the existing PIN remains required and the case files stay untouched.
    beforeRemove();
    if (existsSync(this.path)) unlinkSync(this.path);
    return true;
  }
  verify(pin) {
    const value = this.read();
    if (!value) throw new Error('Create your PIN first.');
    const wait = this.status().retryAfter;
    if (wait) throw new Error(`Please wait ${wait} seconds before trying again.`);
    const valid = typeof pin === 'string' && /^\d{6,12}$/.test(pin);
    const actual = this.derive(valid ? pin : '', value.salt);
    if (!valid || !timingSafeEqual(actual, Buffer.from(value.hash, 'hex'))) {
      value.failures++;
      value.retryAt = this.now() + (value.failures >= 5 ? Math.min(900, 30 * 2 ** Math.min(5, value.failures - 5)) * 1000 : 0);
      this.write(value);
      throw new Error(value.retryAt > this.now() ? `Too many attempts. Please wait ${this.status().retryAfter} seconds.` : 'That PIN was not recognised. Please try again.');
    }
    this.write({ ...value, failures: 0, retryAt: 0 });
    return true;
  }
}
module.exports = { PinSecurity };
