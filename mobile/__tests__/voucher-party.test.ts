import { describe, expect, it } from '@jest/globals';
import { resolveVoucherPresetParty } from '../src/utils/voucher-party';

describe('voucher preset party resolution', () => {
  const groups = {
    customers: [{ code: '20011', nameAr: 'عميل تجريبي', linkedAccounts: [{ accountCode: '112101001' }] }],
    debtors: [{ code: '20011', nameAr: 'عميل سلفة تجريبي', linkedAccounts: [{ accountCode: '113101002' }] }],
  };

  it('maps an ADV platform code to the Oracle debtor account', () => {
    const result = resolveVoucherPresetParty(groups, 'ADV-20011', 'عميل سلفة تجريبي');
    expect(result?.category).toBe('debtors');
    expect((result?.party.linkedAccounts?.[0] as any)?.accountCode).toBe('113101002');
  });

  it('keeps a normal customer code in the customers category', () => {
    const result = resolveVoucherPresetParty(groups, '20011', 'عميل تجريبي');
    expect(result?.category).toBe('customers');
    expect(result?.party.nameAr).toBe('عميل تجريبي');
  });
});
