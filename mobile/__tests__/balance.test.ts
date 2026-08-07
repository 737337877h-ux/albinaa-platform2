/**
 * Balance computation tests.
 *
 * These tests verify the balance logic that powers Customer 360:
 * - operationalBalance = accountingBalance + ledgerDelta (since last import)
 * - Posting a collection creates a negative ledger entry (-amount)
 * - Reversing a collection creates a positive ledger entry (+amount) restoring balance
 *
 * The tests are pure functions that mimic the backend logic, suitable for
 * mobile-side validation of the balance display.
 */

import { describe, it, expect } from '@jest/globals';
import { computeBalance, applyLedgerEntries, LedgerEntry } from '../src/utils/balance';
import { totalsByCurrency } from '../src/utils/customer';

describe('balance', () => {
  describe('portfolio totals', () => {
    const accounts = [
      { balances: [{ currency: 'YER', balance: 1_000 }, { currency: 'SAR', balance: 50 }] },
      { balances: [{ currency: 'YER', balance: -300 }, { currency: 'SAR', balance: -10 }] },
      { balances: [{ currency: 'YER', balance: 200 }] },
    ];

    it('uses positive debtor balances for the customer debt card', () => {
      expect(totalsByCurrency(accounts, true)).toEqual({ YER: 1_200, SAR: 50 });
    });

    it('can still calculate signed net balances for advance accounts', () => {
      expect(totalsByCurrency(accounts)).toEqual({ YER: 900, SAR: 40 });
    });
  });

  describe('computeBalance', () => {
    it('returns accounting balance when no ledger entries', () => {
      const result = computeBalance({ accountingBalance: 1000, ledgerEntries: [] });
      expect(result.accountingBalance).toBe(1000);
      expect(result.operationalBalance).toBe(1000);
    });

    it('subtracts collection from operational balance', () => {
      const result = computeBalance({
        accountingBalance: 1000,
        ledgerEntries: [{ entryType: 'collection', amountSigned: -200 }],
      });
      expect(result.accountingBalance).toBe(1000);
      expect(result.operationalBalance).toBe(800);
    });

    it('adds reversal to operational balance', () => {
      const result = computeBalance({
        accountingBalance: 1000,
        ledgerEntries: [
          { entryType: 'collection', amountSigned: -200 },
          { entryType: 'collection_reversal', amountSigned: 200 },
        ],
      });
      expect(result.operationalBalance).toBe(1000);
    });

    it('handles multiple collections', () => {
      const result = computeBalance({
        accountingBalance: 1000,
        ledgerEntries: [
          { entryType: 'collection', amountSigned: -100 },
          { entryType: 'collection', amountSigned: -150 },
          { entryType: 'collection', amountSigned: -50 },
        ],
      });
      expect(result.operationalBalance).toBe(700);
    });

    it('handles non-collection ledger entries', () => {
      const result = computeBalance({
        accountingBalance: 1000,
        ledgerEntries: [
          { entryType: 'adjustment', amountSigned: 50 },
          { entryType: 'collection', amountSigned: -200 },
        ],
      });
      expect(result.operationalBalance).toBe(850);
    });
  });

  describe('applyLedgerEntries', () => {
    it('before collection - balance is full', () => {
      const balance = { accountingBalance: 1000, operationalBalance: 1000 };
      expect(balance.operationalBalance).toBe(1000);
    });

    it('after posted collection - balance reduced', () => {
      let balance = { accountingBalance: 1000, operationalBalance: 1000 };
      balance = applyLedgerEntries(balance, { entryType: 'collection', amountSigned: -300 });
      expect(balance.operationalBalance).toBe(700);
      expect(balance.accountingBalance).toBe(1000);
    });

    it('reversed collection restores balance', () => {
      let balance = { accountingBalance: 1000, operationalBalance: 1000 };
      balance = applyLedgerEntries(balance, { entryType: 'collection', amountSigned: -300 });
      expect(balance.operationalBalance).toBe(700);
      balance = applyLedgerEntries(balance, { entryType: 'collection_reversal', amountSigned: 300 });
      expect(balance.operationalBalance).toBe(1000);
    });
  });
});
