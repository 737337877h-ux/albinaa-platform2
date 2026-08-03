import { DEFAULT_MESSAGE_TEMPLATES, parseMessageTemplates, renderMessageTemplate } from './messaging';

describe('message templates', () => {
  it('renders supported customer and balance variables', () => {
    expect(renderMessageTemplate('{customerName}: {balance} {currency} / {debtAgeDays}', {
      customerName: 'أحمد', balance: 12500, currency: 'YER', debtAgeDays: 8,
    })).toBe('أحمد: 12,500 YER / 8');
  });

  it('uses safe defaults for invalid stored settings', () => {
    expect(parseMessageTemplates('not-json')).toEqual(DEFAULT_MESSAGE_TEMPLATES);
    expect(parseMessageTemplates([])).toEqual(DEFAULT_MESSAGE_TEMPLATES);
  });

  it('accepts serialized editable templates', () => {
    const input = [{ id: 'one', name: 'اختبار', channel: 'sms', body: 'مرحبًا', active: true }];
    expect(parseMessageTemplates(JSON.stringify(input))).toEqual(input);
  });
});
