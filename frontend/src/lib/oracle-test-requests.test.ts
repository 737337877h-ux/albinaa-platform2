import { describe, expect, it } from 'vitest';
import {
  accountLinkKey, allowedPartyCurrencies, approvedReceiptCollectionRows, automaticCollector, filterParties,
  oracleCurrencyLabel, resolvePartyLink, sumAmounts, type OracleParty,
} from './oracle-test-requests';

const link = { accountCode: '112101001', accountName: 'العملاء', analyticalAccountCode: '20027', analyticalAccountName: 'عميل', analyticalType: 3, currencyCodes: ['SR', 'YR'] };

describe('Oracle test-request UI helpers', () => {
  it('resolves a sole linked account without exposing manual technical entry', () => {
    const party: OracleParty = { code: '20027', nameAr: 'عميل', nameEn: null, phone: null, linkedAccounts: [link] };
    expect(resolvePartyLink(party, '')).toEqual(link);
    expect(resolvePartyLink(party, accountLinkKey(link))).toEqual(link);
  });

  it('does not guess when a party has multiple linked accounts', () => {
    const party: OracleParty = { code: '1', nameAr: 'طرف', nameEn: null, phone: null, linkedAccounts: [link, { ...link, accountCode: '2' }] };
    expect(resolvePartyLink(party, '')).toBeUndefined();
  });

  it('limits currencies to the selected linked account', () => {
    const other = { ...link, accountCode: '2', currencyCodes: ['$'] };
    const party: OracleParty = { code: '1', nameAr: 'طرف', nameEn: null, phone: null, linkedAccounts: [link, other] };
    expect(allowedPartyCurrencies(party, '')).toEqual(['$', 'SR', 'YR']);
    expect(allowedPartyCurrencies(party, accountLinkKey(other))).toEqual(['$']);
  });

  it('uses an assigned collector only when all assigned customers agree', () => {
    const first: OracleParty = { code: '1', nameAr: 'أ', nameEn: null, phone: null, linkedAccounts: [], assignedCollector: { code: '7', nameAr: 'محصل', commissionPercent: 3 } };
    const second: OracleParty = { ...first, code: '2' };
    expect(automaticCollector([first, second])?.code).toBe('7');
    expect(automaticCollector([first, { ...second, assignedCollector: { code: '8', nameAr: 'آخر', commissionPercent: null } }])).toBeUndefined();
  });

  it('filters parties by code, name, or phone', () => {
    const parties: OracleParty[] = [
      { code: '10001', nameAr: 'دار الناصرة', nameEn: null, phone: '777123456', linkedAccounts: [] },
      { code: '1', nameAr: 'عبد الرحمن', nameEn: null, phone: null, linkedAccounts: [] },
    ];
    expect(filterParties(parties, '10001')).toHaveLength(1);
    expect(filterParties(parties, 'الناصرة')).toHaveLength(1);
    expect(filterParties(parties, '777123456')).toHaveLength(1);
  });

  it('totals multiple document lines', () => expect(sumAmounts([{ amount: '40' }, { amount: 60 }])).toBe(100));

  it('formats Oracle currency codes with stable Arabic names', () => {
    expect(oracleCurrencyLabel('YR', 'اسم قديم')).toBe('ريال يمني (YR)');
    expect(oracleCurrencyLabel('SR')).toBe('ريال سعودي (SR)');
    expect(oracleCurrencyLabel('$')).toBe('دولار أمريكي ($)');
  });

  it('turns only approved and complete Oracle receipts into collection rows without duplicates', () => {
    const rows = approvedReceiptCollectionRows([{
      kind: 'receipt', requestNo: '4', requestSerial: '44', status: 'approved',
      amount: 88_400, currencyCode: 'YER', createdAt: '2026-08-31T15:32:59Z',
      platformCustomerCode: '30054', recipientName: 'بشير العبادي المحطة',
      collectorId: 'collector-2', collectorName: 'المحصل التجريبي الثاني',
    }, {
      kind: 'receipt', requestNo: '3', requestSerial: '33', status: 'pending_approval',
      amount: 10_000, currencyCode: 'YER',
    }]);
    expect(rows).toEqual([expect.objectContaining({
      id: 'oracle-approved-receipt:44', amount: 88_400, currencyCode: 'YER', status: 'approved',
      referenceNumber: '44', source: 'oracle_approved_receipt',
      customer: expect.objectContaining({ name: 'بشير العبادي المحطة', externalCustomerCode: '30054' }),
      collector: expect.objectContaining({ user: { fullName: 'المحصل التجريبي الثاني' } }),
    })]);
    expect(approvedReceiptCollectionRows([{
      kind: 'receipt', requestSerial: '44', status: 'approved', amount: 88_400, currencyCode: 'YER',
    }], ['44'])).toEqual([]);
  });

  it('uses the confirmed final-receipt link to avoid counting a request and final receipt twice', () => {
    const request = {
      kind: 'receipt', requestNo: '93', requestSerial: 'request-93', status: 'approved',
      amount: 100_000, currencyCode: 'YER', createdAt: '2026-10-27T17:43:11Z',
      recipientName: 'اسماعيل علي ناجي الحطوار',
    };
    // Different Oracle serials cannot defeat the server-confirmed link, even when
    // the final row falls outside the current page's existingReferences list.
    expect(approvedReceiptCollectionRows([{ ...request, finalReceiptId: 'oracle-direct:receipt-13' }], [])).toEqual([]);
    // Equal customer/amount/time alone is not proof: keep unlinked approved work.
    expect(approvedReceiptCollectionRows([{ ...request, finalReceiptId: null }], [])).toHaveLength(1);
  });
});
