/**
 * Multer/busboy may expose UTF-8 multipart filenames as Latin-1 text.
 * Repair only strings that contain the characteristic mojibake markers;
 * ordinary Arabic, English, and already-correct Unicode names are preserved.
 */
export function normalizeUploadedFilename(name: string): string {
  const cleaned = name.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '').trim();
  if (!/[ÃØÙ]/.test(cleaned)) return cleaned;
  try {
    const repaired = Buffer.from(cleaned, 'latin1').toString('utf8');
    return repaired.includes('\uFFFD') ? cleaned : repaired;
  } catch {
    return cleaned;
  }
}
