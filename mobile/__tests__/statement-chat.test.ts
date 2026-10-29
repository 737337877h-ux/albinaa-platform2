import { describe, it, expect } from '@jest/globals';
import { contactLinks, uniqueContactNumbers } from '../src/utils/contact';

describe('statement direct customer chat', () => {
  it('targets the saved number and pre-fills one Arabic message', () => {
    const message = 'الأخ/ أحمد، مرفق كشف الحساب & للمراجعة';
    const url = new URL(contactLinks('٧٧١٢٣٤٥٦٧', message)!.whatsapp);
    expect(url.pathname).toBe('/967771234567');
    expect(url.searchParams.get('text')).toBe(message);
    expect([...url.searchParams.keys()]).toEqual(['text']);
  });
  it('deduplicates alternative formats without choosing an unrelated recipient', () => {
    expect(uniqueContactNumbers(['+967771234567', '٧٧١٢٣٤٥٦٧', '00967771234567'])).toHaveLength(1);
    expect(contactLinks('', 'تنبيه')).toBeNull();
  });
  it('keeps old callers without a prefilled message unchanged', () => {
    expect(contactLinks('771234567')!.whatsapp).toBe('https://wa.me/967771234567');
  });
});
