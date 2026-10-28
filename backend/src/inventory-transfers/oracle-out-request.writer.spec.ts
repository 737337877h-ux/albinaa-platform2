import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OracleOutRequestHttpWriter } from './oracle-out-request.writer';

describe('OracleOutRequestHttpWriter', () => {
  const input = {
    externalReference: 'inventory-transfer:id', sourceWarehouseCode: '1', destinationWarehouseCode: '2',
    lines: [{ itemCode: '00101-01-01', unitCode: 'حبة', quantity: 1 }],
  };

  afterEach(() => jest.restoreAllMocks());

  it('is disabled by default and performs no request', async () => {
    const writer = new OracleOutRequestHttpWriter(new ConfigService({}));
    expect(writer.isEnabled()).toBe(false);
    await expect(writer.createDraft(input)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('blocks mixed read/write schemas before calling the gateway', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const writer = new OracleOutRequestHttpWriter(new ConfigService({
      ORACLE_WRITE_ENABLED: 'true', ORACLE_WRITE_API_URL: 'http://writer.test', ORACLE_WRITE_API_KEY: 'key',
      ORACLE_READ_SCHEMA: 'IAS20261', ORACLE_WRITE_SCHEMA: 'IAS20191',
    }));
    await expect(writer.createDraft(input)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts only when both schemas are the isolated IAS20191 schema', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      created: true, requestNo: '3', requestSerial: '20190000013',
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const writer = new OracleOutRequestHttpWriter(new ConfigService({
      ORACLE_WRITE_ENABLED: 'true', ORACLE_WRITE_API_URL: 'http://writer.test/', ORACLE_WRITE_API_KEY: 'key',
      ORACLE_READ_SCHEMA: 'IAS20191', ORACLE_WRITE_SCHEMA: 'IAS20191',
    }));
    await expect(writer.createDraft(input)).resolves.toEqual({
      created: true, requestNo: '3', requestSerial: '20190000013',
    });
    expect(fetch).toHaveBeenCalledWith('http://writer.test/inventory/out-requests', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer key' }),
    }));
  });

  it('uses the dedicated IAS20261 transfer writer without permitting insufficient stock', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      created: true, requestNo: '31', requestSerial: '202600000131',
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const writer = new OracleOutRequestHttpWriter(new ConfigService({
      ORACLE_IAS20261_TRANSFER_WRITE_ENABLED: 'true',
      ORACLE_IAS20261_TRANSFER_WRITE_API_URL: 'http://ias20261-writer.test/',
      ORACLE_IAS20261_TRANSFER_WRITE_API_KEY: 'transfer-key',
      ORACLE_IAS20261_TRANSFER_WRITE_SCHEMA: 'IAS20261',
      ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_WRITE_ENABLED: 'true', ORACLE_WRITE_SCHEMA: 'IAS20191',
    }));
    expect(writer.isEnabled()).toBe(true);
    expect(writer.allowsInsufficientStock()).toBe(false);
    expect(writer.targetSchema()).toBe('IAS20261');
    await expect(writer.createDraft(input)).resolves.toEqual({
      created: true, requestNo: '31', requestSerial: '202600000131',
    });
    expect(fetch).toHaveBeenCalledWith('http://ias20261-writer.test/inventory/out-requests', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer transfer-key' }),
    }));
  });
});
