import { contactLinks, normalizePhone } from './contact';

describe('normalizePhone', () => {
  it.each([
    ['777123456', '967777123456'],
    ['0777123456', '967777123456'],
    ['+967 777 123 456', '967777123456'],
    ['00967-777-123-456', '967777123456'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('rejects missing and implausible numbers', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('123')).toBeNull();
  });
});

describe('contactLinks', () => {
  it('builds call, SMS and WhatsApp links', () => {
    expect(contactLinks('777123456')).toEqual({
      tel: 'tel:+967777123456',
      sms: 'sms:+967777123456',
      whatsapp: 'https://wa.me/967777123456',
    });
  });
});
