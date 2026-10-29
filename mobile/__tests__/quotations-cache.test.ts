import { beforeEach, expect, test, jest } from '@jest/globals';
jest.mock('../src/api/client', () => ({ getClient: jest.fn<(...args: any[]) => Promise<any>>() }));
jest.mock('../src/db/database', () => ({ getReferenceOptions: jest.fn<(...args: any[]) => Promise<any>>(), mergeReferenceOptions: jest.fn<(...args: any[]) => Promise<any>>(), replaceReferenceOptions: jest.fn<(...args: any[]) => Promise<any>>() }));
import { getClient } from '../src/api/client';
import { getReferenceOptions, replaceReferenceOptions } from '../src/db/database';
import { collectQuotationPages, fetchQuotationDetail, fetchQuotationsOfflineSnapshot } from '../src/api/quotations';

beforeEach(() => { jest.clearAllMocks(); });
test('collects subsequent pages without losing long serial precision or duplicate rows', async () => {
  const serial = '2026000001526123456789';
  const client = { get: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValueOnce({ data: { items: [{ SERIAL: serial, DOCUMENT_NO: '6' }], nextAfterSerial: serial } })
    .mockResolvedValueOnce({ data: { items: [{ SERIAL: '123', DOCUMENT_NO: '5' }], nextAfterSerial: null } }) };
  const rows = await collectQuotationPages(client);
  expect(rows.map(row => row.SERIAL)).toEqual([serial, '123']);
  expect(client.get).toHaveBeenLastCalledWith('/quotations', { params: { afterSerial: serial } });
});
test('a failed later page preserves the previous complete offline snapshot', async () => {
  (getClient as any).mockResolvedValue({ get: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValueOnce({ data: { items: [{ SERIAL: '6' }], nextAfterSerial: '6' } }).mockRejectedValueOnce(new Error('offline')) });
  await expect(fetchQuotationsOfflineSnapshot()).rejects.toThrow('offline');
  expect(replaceReferenceOptions).not.toHaveBeenCalled();
});
test('repeated cursor fails instead of looping and overwriting the cache', async () => {
  await expect(collectQuotationPages({ get: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({ data: { items: [], nextAfterSerial: '6' } }) })).rejects.toThrow('تكرر');
});
test('cached details work offline but do not hide revoked authorization', async () => {
  (getReferenceOptions as any).mockResolvedValue([{ id: '6', lines: [{ ITEM_CODE: 'A' }] }]);
  (getClient as any).mockResolvedValue({ get: jest.fn<(...args: any[]) => Promise<any>>().mockRejectedValue(new Error('offline')) });
  await expect(fetchQuotationDetail('6')).resolves.toMatchObject({ offline: true, lines: [{ ITEM_CODE: 'A' }] });
  (getClient as any).mockResolvedValue({ get: jest.fn<(...args: any[]) => Promise<any>>().mockRejectedValue({ response: { status: 403 } }) });
  await expect(fetchQuotationDetail('6')).rejects.toMatchObject({ response: { status: 403 } });
});
