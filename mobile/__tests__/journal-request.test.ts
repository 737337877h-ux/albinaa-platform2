import { describe, expect, it } from '@jest/globals';
import {
  hasDebitAndCredit,
  journalDryRunSuccessMessage,
  normalizeJournalReference,
  ORACLE_JOURNAL_REFERENCE_MAX_LENGTH,
} from '../src/utils/journal-request';

describe('journal request validation', () => {
  it('allows debit and credit lines to use different currencies before Oracle Dry Run', () => {
    expect(hasDebitAndCredit([
      { direction: 'debit', currencyCode: 'YR', amount: 140 },
      { direction: 'credit', currencyCode: 'SR', amount: 1 },
    ])).toBe(true);
  });

  it('still requires both journal sides', () => {
    expect(hasDebitAndCredit([{ direction: 'debit' }])).toBe(false);
  });

  it('limits the visible Oracle reference to fifteen characters', () => {
    expect(ORACLE_JOURNAL_REFERENCE_MAX_LENGTH).toBe(15);
    expect(normalizeJournalReference('DRY-JRN-20260829')).toBe('DRY-JRN-2026082');
  });

  it('shows the Oracle local-currency balance returned by Dry Run', () => {
    expect(journalDryRunSuccessMessage({ localBalance: 0, localCurrency: 'SR' }))
      .toBe('تم التحقق حسب سعر صرف IAS20261.\nالفرق بعد التحويل: 0 SR');
  });
});
