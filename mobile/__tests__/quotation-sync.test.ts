import { beforeEach, expect, test, jest } from '@jest/globals';
jest.mock('../src/db/database', () => ({ mergeReferenceOptions: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(undefined) }));
import { mergeReferenceOptions } from '../src/db/database';
import { newQuotationReference, submitQueuedQuotation } from '../src/utils/quotation-sync';

const payload = { externalReference: '6bb74adc-2772-4828-8c3b-ef0578e402a1', lines: [{ quantity: '2', price: '5000' }] };
beforeEach(() => { jest.clearAllMocks(); });

test('lost save response retries the exact request and records the returned Oracle number', async () => {
  const client = { post: jest.fn<(...args: any[]) => Promise<any>>().mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValueOnce({ data: { created: false, serial: '2026000001526', number: '6' } }) };
  await expect(submitQueuedQuotation(client, payload)).rejects.toThrow('Network Error');
  await submitQueuedQuotation(client, payload);
  expect(client.post.mock.calls[0]).toEqual(client.post.mock.calls[1]);
  expect(client.post).toHaveBeenCalledTimes(2);
  expect(mergeReferenceOptions).toHaveBeenCalledWith('quotationReceipts', [expect.objectContaining({ id: payload.externalReference, number: '6', serial: '2026000001526' })]);
});
test('a busy numbering lock remains retryable; validation errors remain blocked', async () => {
  const lock = { response: { status: 409 } };
  await expect(submitQueuedQuotation({ post: jest.fn<(...args: any[]) => Promise<any>>().mockRejectedValue(lock) }, payload)).rejects.toMatchObject({ response: { status: 503 } });
  const invalid = { response: { status: 400 } };
  await expect(submitQueuedQuotation({ post: jest.fn<(...args: any[]) => Promise<any>>().mockRejectedValue(invalid) }, payload)).rejects.toBe(invalid);
});
test('missing identity never reaches the writer and missing acknowledgement is not marked saved', async () => {
  const client = { post: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({ data: {} }) };
  await expect(submitQueuedQuotation(client, {})).rejects.toMatchObject({ response: { status: 422 } });
  expect(client.post).not.toHaveBeenCalled();
  await expect(submitQueuedQuotation(client, payload)).rejects.toThrow('لم يصل تأكيد');
  expect(mergeReferenceOptions).not.toHaveBeenCalled();
});
test('new references match the backend UUID contract', () => {
  expect(newQuotationReference()).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
