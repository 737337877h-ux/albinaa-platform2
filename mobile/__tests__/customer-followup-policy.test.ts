import { describe, expect, it } from '@jest/globals';
import { isActionableBalance, totalActionableDebtorBalance } from '../src/utils/customer';

describe('mobile follow-up balance policy', () => {
  it('excludes zero, credit, and configured small balances', () => {
    expect(isActionableBalance({ currency: 'YER', balance: 3000 })).toBe(false);
    expect(isActionableBalance({ currency: 'SAR', balance: 30 })).toBe(false);
    expect(isActionableBalance({ currency: 'USD', balance: 5 })).toBe(false);
    expect(isActionableBalance({ currency: 'YER', balance: -500 })).toBe(false);
  });

  it('keeps an account when at least one currency exceeds its limit', () => {
    expect(totalActionableDebtorBalance([
      { currency: 'YER', balance: 2500 },
      { currency: 'USD', balance: 5.5 },
    ])).toBe(5.5);
  });
});
