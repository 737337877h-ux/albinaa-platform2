import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerCallLink } from './customer-call-link';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/toast';
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }));

describe('customer call registration', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api).mockResolvedValue({ status: 'pending' }); });
  it('queues one delayed attempt and retains the native telephone action', async () => {
    render(<CustomerCallLink customerId="customer-id" href="tel:+967700000000">اتصال</CustomerCallLink>);
    const link = screen.getByRole('link');
    fireEvent.click(link);
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    const [path, init] = vi.mocked(api).mock.calls[0];
    expect(path).toBe('/followups/contact-attempts');
    expect(init).toMatchObject({ method: 'POST', keepalive: true });
    const data = JSON.parse(init!.body as string);
    expect(data).toMatchObject({ customerId: 'customer-id', channel: 'call' });
    expect(data.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(data.occurredAt))).toBe(false);
    expect(link).toHaveAttribute('href', 'tel:+967700000000');
  });
  it('shows registration failures so the user can record the result manually', async () => {
    vi.mocked(api).mockRejectedValue(new Error('offline'));
    render(<CustomerCallLink customerId="customer-id" href="tel:+967700000000">اتصال</CustomerCallLink>);
    fireEvent.click(screen.getByRole('link'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('يدويًا'), 'err'));
  });
});
