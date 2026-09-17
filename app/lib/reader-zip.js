import { inflateRawSync } from 'node:zlib';

const CRC = Array.from({ length: 256 }, (_, i) => {
  for (let bit = 0; bit < 8; bit++) i = (i & 1) ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
  return i >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Never delegate untrusted ZIP entry paths to a native extraction command.
// Callers receive verified bytes and choose their own storage destinations.
export function readZip(bytes, { maxEntries = 1000, maxBytes = 512 * 1024 * 1024, maxEntryBytes = 256 * 1024 * 1024, filter = () => true } = {}) {
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0) throw new Error('The ZIP archive is damaged or unsupported.');
  const count = bytes.readUInt16LE(end + 10), start = bytes.readUInt32LE(end + 16), directorySize = bytes.readUInt32LE(end + 12);
  if (count === 0xffff || start === 0xffffffff || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error('Split and ZIP64 archives are not supported.');
  if (count > maxEntries || start + directorySize > end) throw new Error('The ZIP archive exceeds the extraction limits.');
  let cursor = start, total = 0;
  const entries = [], names = new Set();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('The ZIP directory is damaged.');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), expectedCrc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32), mode = bytes.readUInt32LE(cursor + 38) >>> 16;
    const local = bytes.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameLength + extraLength + commentLength > end) throw new Error('The ZIP directory is truncated.');
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8').replaceAll('\\', '/');
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!name || name.startsWith('/') || /[\x00-\x1f:]/.test(name) || name.split('/').some((part) => part === '..' || part === '.') || (mode & 0xf000) === 0xa000) throw new Error('The ZIP contains an unsafe path or symbolic link.');
    if (names.has(name.toLowerCase())) throw new Error('The ZIP contains duplicate paths.');
    names.add(name.toLowerCase());
    if (flags & 1) throw new Error('This archive is password-protected. Import an unlocked copy.');
    if (name.endsWith('/')) continue;
    total += size;
    if (size > maxEntryBytes || total > maxBytes || (compressed && size / compressed > 1000)) throw new Error('The ZIP archive exceeds the extraction limits.');
    if (!filter(name)) continue;
    if (![0, 8].includes(method)) throw new Error('This ZIP compression method is not supported.');
    if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('The ZIP file entry is damaged.');
    const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (dataStart + compressed > start) throw new Error('The ZIP file entry is truncated.');
    const input = bytes.subarray(dataStart, dataStart + compressed);
    const data = method === 0 ? Buffer.from(input) : inflateRawSync(input, { maxOutputLength: Math.max(1, Math.min(maxEntryBytes, size)) });
    if (data.length !== size || crc32(data) !== expectedCrc) throw new Error('The ZIP file entry failed its integrity check.');
    entries.push({ name, bytes: data });
  }
  return entries;
}
