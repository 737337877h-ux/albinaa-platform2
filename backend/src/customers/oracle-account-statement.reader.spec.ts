import { ConfigService } from '@nestjs/config';
import { OracleAccountStatementReader } from './oracle-account-statement.reader';

describe('platform historical account statement', () => {
  const originalFetch = global.fetch;
  const config = { get: (key: string) => ({ ORACLE_READ_API_URL: 'http://read-only', ORACLE_READ_API_KEY: 'test', ORACLE_READ_SCHEMA: 'IAS20261' } as any)[key] };
  const customer = { customerType: 'advance', externalCustomerCode: 'ADV-20011', accountNumber: '20011' };
  const query = { currency: 'YER', fromDate: '2025-01-01', toDate: '2026-09-06' };
  const payload = { mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema: 'IAS20261', source: 'IAS_V_POST_DTL_YR', readAt: '2026-09-06T12:00:00Z', coverageStart: '2020-01-01',
    rows: [{ OPENING: 100.1, TOTAL_DEBIT: 50.2, TOTAL_CREDIT: 10.3, TOTAL: 1, RN: 1,
      DEBIT: 50.2, CREDIT: 10.3, PERIOD_RUNNING: 39.9, DOCUMENT_SERIAL: '20260000100000000123', DOCUMENT_NUMBER: '123', DOCUMENT_TYPE: '2', DOCUMENT_DATE: '2025-01-02' }] };
  afterEach(() => { global.fetch = originalFetch; });
  const reader = () => new OracleAccountStatementReader(config as unknown as ConfigService);
  it('retries a transport failure once without returning cached balances', async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce({ok:true,status:200,json:async()=>payload});
    expect((await reader().read(customer, query)).periodEndBalance).toBe(140);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
  it('distinguishes repeated timeout and stops after two attempts', async () => {
    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('timeout'),{name:'TimeoutError'}));
    await expect(reader().read(customer,query)).rejects.toThrow('المهلة');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
  it('labels the verified currency difference document', async () => {
    global.fetch=jest.fn().mockResolvedValue({ok:true,status:200,json:async()=>({...payload,rows:[{...payload.rows[0],DOCUMENT_TYPE:'50'}]})});
    expect((await reader().read(customer,query)).items[0].documentType).toBe('قيد فروق عملة');
  });
  it('uses actual advance number, preserves long serial and exact decimal running balance', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload });
    const result = await reader().read(customer, query);
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain('kind=advance&code=20011');
    expect(result.periodEndBalance).toBe(140);
    expect(result.items[0].runningBalance).toBe(140);
    expect(result.items[0].id).toContain('20260000100000000123');
    expect(result.balanceAsOf).toBe(query.toDate);
  });
  it('rejects partial archive instead of issuing a misleading report', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...payload, rows: [{ ...payload.rows[0], TOTAL: 2 }] }) });
    await expect(reader().read(customer, query)).rejects.toThrow('غير مكتمل');
  });
  it('does not fall back to incomplete platform data when the source fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(reader().read(customer, query)).rejects.toThrow('لم يتم استبداله');
  });
  it('requires a period and verified analytical number', async () => {
    await expect(reader().read({ ...customer, accountNumber: null }, query)).rejects.toThrow('رقم Oracle');
    await expect(reader().read(customer, { currency: 'SAR' })).rejects.toThrow('الفترة');
  });
});
