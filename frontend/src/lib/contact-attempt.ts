import { api } from './api';
import { createRequestId } from './request-id';

export type ContactChannel = 'call' | 'sms' | 'whatsapp';

// Start before opening the external app, without awaiting first: browsers
// require the original click gesture for tel/sms/WhatsApp protocols.
export async function registerContactAttempt(customerId: string, channel: ContactChannel) {
  const operationId = createRequestId();
  return api<{ id: string; status: 'pending' | 'suppressed' | 'completed' }>(
    '/followups/contact-attempts',
    {
      method: 'POST',
      keepalive: true,
      body: JSON.stringify({ operationId, customerId, channel, occurredAt: new Date().toISOString() }),
      headers: { 'Idempotency-Key': operationId },
    },
  );
}
