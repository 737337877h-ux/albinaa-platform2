import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { registerContactAttempt } from './contact-attempt';
vi.mock('./api', () => ({ api: vi.fn() }));
describe('message attempts use the shared delayed policy', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api).mockResolvedValue({ status: 'pending' }); });
  it.each(['sms', 'whatsapp'] as const)('registers %s without an immediate follow-up', async channel => {
    await registerContactAttempt('customer-id', channel);
    const [path, options] = vi.mocked(api).mock.calls[0];
    expect(path).toBe('/followups/contact-attempts');
    const payload = JSON.parse(options!.body as string);
    expect(payload).toMatchObject({ channel, customerId: 'customer-id' });
    expect(options!.headers).toEqual({ 'Idempotency-Key': payload.operationId });
    expect(api).toHaveBeenCalledOnce();
  });
});
