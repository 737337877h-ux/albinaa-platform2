import { describe, expect, it } from '@jest/globals';
import {
  balanceAmount, canonicalCurrencyCode, customerEngagementIds, grossTotalsByCurrencySide, hasCustomerEngagement, isActionableBalance, isBalanceForCurrencySide,
  totalActionableDebtorBalance, totalBalanceForCurrencySide,
} from '../src/utils/customer';

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

  it('filters debtor and creditor accounts by normalized currency', () => {
    const balances = [
      { currency: 'YR', balance: 5000 },
      { currency: 'USD', balance: -20 },
      { currency: 'SR', balance: 30 },
    ];
    expect(canonicalCurrencyCode('YR')).toBe('YER');
    expect(isBalanceForCurrencySide(balances[0], 'YER', 'debtor')).toBe(true);
    expect(totalBalanceForCurrencySide(balances, 'USD', 'creditor')).toBe(20);
    expect(totalBalanceForCurrencySide(balances, 'SAR', 'debtor')).toBe(0);
  });

  it('keeps small balances out of work lists but includes them in dashboard totals', () => {
    const accounts = [{ balances: [
      { currency: 'YER', balance: 2_500 },
      { currency: 'YER', balance: 5_000 },
      { currency: 'SAR', balance: -12 },
    ] }];
    expect(totalActionableDebtorBalance(accounts[0].balances)).toBe(5_000);
    expect(grossTotalsByCurrencySide(accounts, 'debtor')).toEqual({ YER: 7_500 });
    expect(grossTotalsByCurrencySide(accounts, 'creditor')).toEqual({ SAR: 12 });
  });

  it('prefers the operational balance after a local collection', () => {
    expect(balanceAmount({ accountingBalance: 10_000, balance: 10_000, operationalBalance: 8_000 })).toBe(8_000);
  });

  it('removes customers with any server or local follow-up, promise, or collection activity', () => {
    const local = customerEngagementIds(
      [{ customerId: 'followup' }],
      [{ customerId: 'promise' }],
      [{ customerId: 'collection' }],
    );
    expect(hasCustomerEngagement({ id: 'server', hasRecordedEngagement: true }, local)).toBe(true);
    expect(hasCustomerEngagement({ id: 'followup' }, local)).toBe(true);
    expect(hasCustomerEngagement({ id: 'promise' }, local)).toBe(true);
    expect(hasCustomerEngagement({ id: 'collection' }, local)).toBe(true);
    expect(hasCustomerEngagement({ id: 'never' }, local)).toBe(false);
  });
});
