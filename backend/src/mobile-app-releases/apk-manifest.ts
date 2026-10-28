import { readFile } from 'fs/promises';
import JSZip = require('jszip');

/** Read package/version from Android's binary XML, without executing APK content. */
export function readBinaryManifest(b: Buffer) {
  if (b.length < 8 || b.readUInt16LE(0) !== 3 || b.readUInt32LE(4) !== b.length) throw new Error('Invalid Android manifest');
  let strings: string[] = [];
  for (let p = b.readUInt16LE(2); p + 8 <= b.length;) {
    const type = b.readUInt16LE(p), header = b.readUInt16LE(p + 2), size = b.readUInt32LE(p + 4);
    if (header < 8 || size < header || p + size > b.length) throw new Error('Invalid XML chunk');
    if (type === 1) {
      if (header < 28) throw new Error('Invalid string pool');
      const count = b.readUInt32LE(p + 8), utf8 = !!(b.readUInt32LE(p + 16) & 256), start = b.readUInt32LE(p + 20);
      if (count > 100000 || header + count * 4 > size || start >= size) throw new Error('Invalid string offsets');
      strings = Array.from({ length: count }, (_, i) => {
        let q = p + start + b.readUInt32LE(p + header + i * 4);
        const length8 = () => { const n = b[q++]; return n & 128 ? ((n & 127) << 8) | b[q++] : n; };
        if (q >= p + size) throw new Error('Invalid string');
        if (utf8) { length8(); const n = length8(); if (q + n >= p + size) throw new Error('Invalid UTF8 string'); return b.toString('utf8', q, q + n); }
        let n = b.readUInt16LE(q); q += 2;
        if (n & 32768) { n = ((n & 32767) * 65536) + b.readUInt16LE(q); q += 2; }
        if (q + n * 2 >= p + size) throw new Error('Invalid UTF16 string');
        return b.toString('utf16le', q, q + n * 2);
      });
    }
    if (type === 0x102 && size >= 36 && strings[b.readUInt32LE(p + 20)] === 'manifest') {
      const start = p + 16 + b.readUInt16LE(p + 24), width = b.readUInt16LE(p + 26), count = b.readUInt16LE(p + 28);
      if (width < 20 || start < p + 36 || start + width * count > p + size) throw new Error('Invalid attributes');
      const attrs: Record<string, string | number> = {};
      for (let i = 0; i < count; i++) {
        const q = start + i * width, name = strings[b.readUInt32LE(q + 4)], raw = b.readUInt32LE(q + 8), dataType = b[q + 15], data = b.readUInt32LE(q + 16);
        if (['package', 'versionName', 'versionCode'].includes(name)) attrs[name] = raw !== 0xffffffff ? strings[raw] : dataType === 3 ? strings[data] : data;
      }
      if (typeof attrs.package !== 'string' || typeof attrs.versionName !== 'string' || !Number.isSafeInteger(Number(attrs.versionCode))) throw new Error('Missing APK identity');
      return { packageId: attrs.package, versionName: attrs.versionName, versionCode: Number(attrs.versionCode) };
    }
    p += size;
  }
  throw new Error('Missing manifest root');
}

export async function apkIdentity(filePath: string) {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const entry = zip.file('AndroidManifest.xml');
  if (!entry || (entry as any)._data?.uncompressedSize > 4 * 1024 * 1024) throw new Error('Missing or oversized manifest');
  return readBinaryManifest(await entry.async('nodebuffer'));
}
