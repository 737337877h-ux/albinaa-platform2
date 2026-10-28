import { beforeEach, describe, expect, it, jest } from '@jest/globals';
const mockIds = new Map<string, string>();
const mockBind = jest.fn(async (localId: string, order: any) => {
  mockIds.set(`customer-order-server:${localId}`, order.id);
});
jest.mock('../src/db/database', () => ({
  getMeta: jest.fn(async (key: string) => mockIds.get(key) || null),
  bindCustomerOrderServerId: (...args: [string, any]) => mockBind(...args),
}));
import { resolveCustomerOrderEndpoint, submitQueuedCustomerOrder, submitQueuedOracleCustomerOrder } from '../src/utils/customer-order-sync';

const id = '12345678-1234-1234-1234-123456789012';
const operation = 'customer_order:1788471474381:fe5vq5c5';
const localId = `local:${operation}`;
const payload = { orderKind: 'cash', customerName: 'TEST', lines: [{ quantity: 1, unitPrice: 300 }] };

describe('Oracle customer-order queue',()=>{
  beforeEach(()=>{mockBind.mockClear();});
  const get=()=>jest.fn<(...args:any[])=>Promise<any>>().mockResolvedValue({data:{draftScope:'org:user',createEnabled:true}});
  it('retries the identical reference without running a new credit preview',async()=>{
    const client={get:get(),post:jest.fn<(...args:any[])=>Promise<any>>().mockRejectedValueOnce(new Error('network')).mockResolvedValue({data:{id,sourceSchema:'IAS20261'}})};
    const scoped={...payload,__oracleScope:'org:user'};
    await expect(submitQueuedOracleCustomerOrder(client,operation,scoped)).rejects.toThrow('network');
    await submitQueuedOracleCustomerOrder(client,operation,scoped);
    expect(client.post.mock.calls[0]).toEqual(client.post.mock.calls[1]);
    expect(client.post).toHaveBeenCalledWith('/customer-orders',{...payload,externalReference:operation},{timeout:120000});
    expect(mockBind).toHaveBeenCalledWith(localId,{id,sourceSchema:'IAS20261'});
  });
  it('blocks a different signed-in account before sending',async()=>{
    const client={get:get(),post:jest.fn()};
    await expect(submitQueuedOracleCustomerOrder(client,operation,{...payload,__oracleScope:'org:other'})).rejects.toMatchObject({response:{status:422}});
    expect(client.post).not.toHaveBeenCalled();
  });
  it('keeps a busy or conflicting reference pending instead of editable',async()=>{
    const client={get:get(),post:jest.fn<(...args:any[])=>Promise<any>>().mockRejectedValue({response:{status:409}})};
    await expect(submitQueuedOracleCustomerOrder(client,operation,{...payload,__oracleScope:'org:user'})).rejects.toMatchObject({response:{status:503}});
    expect(mockBind).not.toHaveBeenCalled();
  });
});

describe('customer-order creation and dependent requests', () => {
  beforeEach(() => { mockIds.clear(); mockBind.mockClear(); });

  it('checks then creates at the real route and persists the server identity', async () => {
    const client = { post: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValueOnce({ data: { valid: true } }).mockResolvedValueOnce({ data: { id } }) };
    await submitQueuedCustomerOrder(client, operation, payload);
    expect(client.post.mock.calls.map(call => call[0])).toEqual(['/sales-order-drafts/dry-run', '/sales-order-drafts']);
    expect(client.post).toHaveBeenLastCalledWith('/sales-order-drafts', payload, {
      headers: { 'Idempotency-Key': operation },
      timeout: 120_000,
    });
    expect(mockBind).toHaveBeenCalledWith(localId, { id });
    expect(await resolveCustomerOrderEndpoint(`/sales-order-drafts/${localId}/process`)).toBe(`/sales-order-drafts/${id}/process`);
    expect(await resolveCustomerOrderEndpoint(`/sales-order-drafts/${localId}`)).toBe(`/sales-order-drafts/${id}`);
  });

  it('defers processing without HTTP until the original order is created', async () => {
    const error = await resolveCustomerOrderEndpoint(`/sales-order-drafts/${localId}/process`).catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.response).toBeUndefined();
    expect(error.message).toContain('بانتظار');
  });

  it('reuses the persisted identity after restart, without recreating the order', async () => {
    mockIds.set(`customer-order-server:${localId}`, id);
    const client = { post: jest.fn() };
    expect(await submitQueuedCustomerOrder(client, operation, payload)).toEqual({ data: { id } });
    expect(client.post).not.toHaveBeenCalled();
  });

  it('does not create or bind an order that failed validation', async () => {
    const client = { post: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({ data: { valid: false, issues: [{ message: 'stock' }] } }) };
    await expect(submitQueuedCustomerOrder(client, operation, payload)).rejects.toMatchObject({ response: { status: 422 } });
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(mockBind).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'local:123', '4931'])('retains the creation on an invalid returned id (%s)', async badId => {
    const client = { post: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValueOnce({ data: { valid: true } }).mockResolvedValueOnce({ data: { id: badId } }) };
    await expect(submitQueuedCustomerOrder(client, operation, payload)).rejects.toThrow('رقم طلب صالح');
    expect(mockBind).not.toHaveBeenCalled();
  });

  it('preserves the original idempotency key if the server response is lost', async () => {
    const client = { post: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValueOnce({ data: { valid: true } }).mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: { valid: true } }).mockResolvedValueOnce({ data: { id } }) };
    await expect(submitQueuedCustomerOrder(client, operation, payload)).rejects.toThrow('network');
    await submitQueuedCustomerOrder(client, operation, payload);
    const creates = client.post.mock.calls.filter(call => call[0] === '/sales-order-drafts');
    expect(creates).toHaveLength(2);
    expect(creates[0][2]).toEqual(creates[1][2]);
  });

  it('does not alter UUID, snapshot, or unrelated routes', async () => {
    for (const route of [`/sales-order-drafts/${id}/process`, '/sales-order-drafts/offline', '/collections']) {
      expect(await resolveCustomerOrderEndpoint(route)).toBe(route);
    }
  });

  it('does not send a corrupt saved identity', async () => {
    mockIds.set(`customer-order-server:${localId}`, 'local:bad');
    await expect(resolveCustomerOrderEndpoint(`/sales-order-drafts/${localId}/process`)).rejects.toThrow('بانتظار');
  });
});
