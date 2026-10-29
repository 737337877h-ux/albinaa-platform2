import { ConfigService } from '@nestjs/config';
import { OracleCustomerOrdersReader } from './oracle-customer-orders.reader';

describe('OracleCustomerOrdersReader', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses GET only, IAS20261, and preserves the serial cursor', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema: 'IAS20261', items: [], nextAfterSerial: null }),
    } as Response);
    const reader = new OracleCustomerOrdersReader(new ConfigService({
      ORACLE_READ_API_URL: 'http://oracle-read.test/', ORACLE_READ_API_KEY: 'secret', ORACLE_READ_SCHEMA: 'IAS20261',
    }));
    await reader.page('202600000000000001', 100);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://oracle-read.test/customer-orders?schema=IAS20261&kind=all&limit=100&afterSerial=202600000000000001',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer secret' } }),
    );
  });

  it('fails closed when the schema is not IAS20261', async () => {
    const reader = new OracleCustomerOrdersReader(new ConfigService({
      ORACLE_READ_API_URL: 'http://oracle-read.test', ORACLE_READ_API_KEY: 'secret', ORACLE_READ_SCHEMA: 'IAS20191',
    }));
    await expect(reader.page(null)).rejects.toThrow('مقيدة بـ IAS20261');
  });

  it('rejects a gateway response that does not prove SELECT-only mode', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ mode: 'WRITE', oracleWrite: 'ENABLED', schema: 'IAS20261', items: [] }),
    } as Response);
    const reader = new OracleCustomerOrdersReader(new ConfigService({
      ORACLE_READ_API_URL: 'http://oracle-read.test', ORACLE_READ_API_KEY: 'secret', ORACLE_READ_SCHEMA: 'IAS20261',
    }));
    await expect(reader.page(null)).rejects.toThrow('غير آمنة');
  });
});
