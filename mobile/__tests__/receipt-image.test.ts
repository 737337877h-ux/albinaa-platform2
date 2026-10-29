import { beforeEach, describe, expect, it, jest } from '@jest/globals';
jest.mock('../src/api/client', () => ({ getClient: jest.fn() }));
import { getClient } from '../src/api/client';
import { loadReceiptImage, receiptErrorMessage, normalizeReceiptDataUrl } from '../src/api/receipt-image';

describe('authenticated receipt loading', () => {
  const get = jest.fn<(...args: any[]) => Promise<any>>();
  beforeEach(() => {
    get.mockReset();
    jest.mocked(getClient).mockResolvedValue({ get } as any);
  });
  it('uses the shared client and encodes the attachment ID with cancellation', async () => {
    const signal = new AbortController().signal;
    get.mockRejectedValue(new Error('offline'));
    await expect(loadReceiptImage('a/b', signal)).rejects.toThrow('offline');
    expect(get).toHaveBeenCalledWith('/mobile/receipts/a%2Fb', { responseType: 'blob', signal });
  });
  it('rejects an empty file instead of opening a blank preview', async () => {
    get.mockResolvedValue({ data: { size: 0, type: 'image/jpeg' } });
    await expect(loadReceiptImage('id')).rejects.toThrow('فارغ');
  });
  it('rejects HTML even when mislabeled as JPEG', () => {
    expect(() => normalizeReceiptDataUrl('data:image/jpeg;base64,PGh0bWw+')).toThrow('ليس صورة');
  });
  it.each([
    ['image/jpeg', '/9j/4AAQSkZJRg=='],
    ['image/png', 'iVBORw0KGgoAAA=='],
    ['image/gif', 'R0lGODlhAAAA'],
    ['image/webp', 'UklGRgAAAABXRUJQ'],
  ])('recognizes %s with an empty content type', (mime, base64) => {
    expect(normalizeReceiptDataUrl(`data:;base64,${base64}`)).toBe(`data:${mime};base64,${base64}`);
  });
  it('rejects invalid data URLs', () => {
    expect(() => normalizeReceiptDataUrl('https://example.com/a.jpg')).toThrow();
  });
  it.each([401, 403, 404])('provides an explicit error for HTTP %s', status => {
    expect(receiptErrorMessage({ response: { status } })).not.toContain('تحقق من الاتصال');
  });
});
