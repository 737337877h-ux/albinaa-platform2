import { durableOracleRequest, mergeOracleRequestRecords, platformCurrencyCode } from './oracle-request-audit';

describe('durable Oracle request audit reporting', () => {
  it('preserves the actual method and account without guessing legacy records', () => {
    const row = { id: 'a', entityId: '123', createdAt: new Date(), newValue: { kind: 'voucher', requestKind: 'receipt', paymentMethod: 'cash', cashOrBankNo: 101, description: 'بيان أصلي', referenceNo: 'ref' } };
    expect(durableOracleRequest(row)).toEqual(expect.objectContaining({ paymentMethod: 'cash', cashOrBankNo: '101', description: 'بيان أصلي', referenceNo: 'ref' }));
    expect(durableOracleRequest({ ...row, newValue: { kind: 'receipt' } })?.paymentMethod).toBeNull();
    expect(durableOracleRequest({ ...row, newValue: { kind: 'receipt', paymentMethod: 'unsupported' } })?.paymentMethod).toBeNull();
  });
  it('maps a voucher receipt to a durable pending collection request', () => {
    const createdAt = new Date('2026-08-31T17:32:37.068Z');
    expect(durableOracleRequest({
      id: 'audit-1', entityId: 'serial-1', createdAt,
      newValue: {
        kind: 'voucher', requestKind: 'receipt', requestNo: '2', amount: 17000,
        currencyCode: 'YR', recipientName: 'عميل تجريبي', collectorNo: 2,
      },
    })).toEqual(expect.objectContaining({
      kind: 'receipt', requestNo: '2', requestSerial: 'serial-1', amount: 17000,
      currencyCode: 'YER', collectorNo: 2, status: 'pending_approval', createdAt,
    }));
  });

  it('normalizes the Oracle currency aliases used by receipts', () => {
    expect(platformCurrencyCode('YR')).toBe('YER');
    expect(platformCurrencyCode('SR')).toBe('SAR');
    expect(platformCurrencyCode('USD')).toBe('USD');
  });

  it('keeps the live approval status while filling missing receipt details from the audit', () => {
    expect(mergeOracleRequestRecords({
      kind: 'receipt', requestSerial: '22', status: 'approved',
      platformCustomerCode: '20318', amount: null, currencyCode: null,
    }, {
      kind: 'receipt', requestSerial: '22', status: 'pending_approval',
      amount: 17_000, currencyCode: 'YER', recipientName: 'عميل التحصيل',
    })).toEqual(expect.objectContaining({
      status: 'approved', platformCustomerCode: '20318', amount: 17_000,
      currencyCode: 'YER', recipientName: 'عميل التحصيل',
    }));
  });
});
