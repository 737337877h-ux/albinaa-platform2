import { describe, it, expect } from '@jest/globals';
import { contactLinks, normalizePhone } from '../src/utils/contact';

describe('customer contact links', () => {
  it.each([
    ['777123456', '967777123456'],
    ['0777123456', '967777123456'],
    ['+967 777 123 456', '967777123456'],
    ['00967-777-123-456', '967777123456'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('builds safe call, SMS and WhatsApp links', () => {
    expect(contactLinks('777123456')).toEqual({
      tel: 'tel:+967777123456',
      sms: 'sms:+967777123456',
      whatsapp: 'https://wa.me/967777123456',
    });
  });
});
