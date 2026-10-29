import { normalizeUploadedFilename } from './uploaded-filename';

describe('normalizeUploadedFilename', () => {
  it('preserves a correct Arabic filename', () => {
    expect(normalizeUploadedFilename('كشف حساب العملاء.xlsx')).toBe('كشف حساب العملاء.xlsx');
  });

  it('repairs a UTF-8 filename decoded as latin1', () => {
    const source = 'كشف حساب العملاء.xlsx';
    const mojibake = Buffer.from(source, 'utf8').toString('latin1');
    expect(normalizeUploadedFilename(mojibake)).toBe(source);
  });

  it('removes invisible bidi filename controls', () => {
    expect(normalizeUploadedFilename('\u200E\u2068كشف حساب.pdf\u2069')).toBe('كشف حساب.pdf');
  });
});
