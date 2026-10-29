import { describe, expect, it } from 'vitest';
import { voucherCounterAmount } from './voucher-conversion';
describe('voucher single counterparty conversion', () => {
  const yer = { code: 'YR', rate: 1 / 140, fractionDigits: 2 };
  it('copies same-currency amounts', () => expect(voucherCounterAmount('4000', yer, yer)?.amount).toBe('4000'));
  it('uses catalog rates for cross-currency amounts', () => expect(voucherCounterAmount('4000', yer, { code: 'SR', local: true })?.amount).toBe('28.57'));
  it('blocks invalid rates and amounts', () => {
    expect(voucherCounterAmount('4000', { code: 'YR', rate: 0 }, { code: 'SR', local: true })).toBeNull();
    expect(voucherCounterAmount('-1', yer, yer)).toBeNull();
  });
});
