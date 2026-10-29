import { normalizeVoucherAmount, voucherCounterAmount } from '../src/utils/voucher-conversion';
import { describe, expect, it } from '@jest/globals';
const yer = { code: 'YR', rate: 1 / 140, fractionDigits: 2 };
const sar = { code: 'SR', local: true, rate: 1, fractionDigits: 2 };
describe('voucher amount conversion', () => {
  it('copies the amount for the same currency', () => expect(voucherCounterAmount('4000', yer, yer)?.amount).toBe('4000'));
  it('normalizes Arabic numbers and separators', () => expect(normalizeVoucherAmount('٤٬٠٠٠٫٥٠')).toBe('4000.50'));
  it('uses system local rates and matches server rounding', () => expect(voucherCounterAmount('4000', yer, sar)?.amount).toBe('28.57'));
  it('converts between two foreign currencies through local currency', () => expect(voucherCounterAmount('14000', yer, { code: 'USD', rate: 4, fractionDigits: 2 })?.amount).toBe('25'));
  it('never invents missing rates', () => expect(voucherCounterAmount('4000', { code: 'YR' }, sar)).toBeNull());
  it('reports rounding differences instead of hiding unbalanced amounts', () => expect(voucherCounterAmount('4000', yer, { code: 'USD', rate: 3.75, fractionDigits: 2 })?.roundingDifference).toBe(-0.01));
});
