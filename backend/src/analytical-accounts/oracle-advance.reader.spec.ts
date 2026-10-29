import { normalizeOracleAdvance, platformCurrency, OracleAdvanceReader } from './oracle-advance.reader';

describe('Oracle advance currency and balance mapping', () => {
  it('maps legacy Oracle currency codes to platform codes', () => {
    expect(platformCurrency('YR')).toBe('YER');
    expect(platformCurrency('SR')).toBe('SAR');
    expect(platformCurrency('$')).toBe('USD');
    expect(platformCurrency(null)).toBeNull();
  });

  it('uses the system-local amount for SAR', () => {
    expect(normalizeOracleAdvance({
      sourceAccountCode: '113101001', accountNumber: '10002', nameAr: 'اختبار', nameEn: null,
      analyticalType: 2, currencyCode: 'SR', amountLocal: 8000, amountForeign: 0,
    })).toEqual(expect.objectContaining({ currencyCode: 'SAR', balance: 8000, balanceBasis: 'local' }));
  });

  it('uses the foreign-currency amount for YER and USD', () => {
    expect(normalizeOracleAdvance({
      sourceAccountCode: '113101001', accountNumber: '10001', nameAr: 'اختبار', nameEn: null,
      analyticalType: 2, currencyCode: 'YR', amountLocal: -321.4286, amountForeign: -45000,
    })).toEqual(expect.objectContaining({ currencyCode: 'YER', balance: -45000, balanceBasis: 'foreign' }));
    expect(normalizeOracleAdvance({
      sourceAccountCode: '113101002', accountNumber: '20001', nameAr: 'اختبار', nameEn: null,
      analyticalType: 2, currencyCode: '$', amountLocal: -3732.094, amountForeign: -982.13,
    })).toEqual(expect.objectContaining({ currencyCode: 'USD', balance: -982.13, balanceBasis: 'foreign' }));
  });
});

describe('advance source completeness', () => {
  const original = global.fetch;
  afterEach(() => { global.fetch = original; });
  it.each([{ items: [] }, { items: [{ sourceAccountCode: '113101002', currencyCode: 'UNKNOWN', amountLocal: 1, amountForeign: 1 }] },
    { items: [{ sourceAccountCode: 'OTHER', currencyCode: 'YR', amountLocal: 1, amountForeign: 1 }] }])('rejects an empty or unsupported response', async ({ items }) => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema: 'IAS20261', sourceAccountCodes: ['113101001', '113101002'], items }) });
    const reader = new OracleAdvanceReader({ get: (key: string) => ({ ORACLE_READ_API_URL: 'http://readonly', ORACLE_READ_API_KEY: 'test', ORACLE_READ_SCHEMA: 'IAS20261' } as any)[key] } as any);
    await expect(reader.read()).rejects.toThrow('غير مكتملة');
  });
});
