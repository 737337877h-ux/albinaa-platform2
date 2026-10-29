import { ConfigService } from '@nestjs/config';
import { ReadOnlyOracleHttpReader, transferStatusFromEvidence } from './oracle-inventory.reader';

describe('ReadOnlyOracleHttpReader', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses GET only for Oracle inventory reads', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ exists: true }) } as Response);
    const reader = new ReadOnlyOracleHttpReader(new ConfigService({ ORACLE_READ_API_URL: 'http://oracle-read.test/' }));
    await expect(reader.warehouseExists('W 1')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://oracle-read.test/inventory/warehouses/W%201?schema=IAS20261', expect.objectContaining({ method: 'GET' }));
  });

  it('passes the configured schema without hard-coding it in the reader routes', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ exists: true }) } as Response);
    const reader = new ReadOnlyOracleHttpReader(new ConfigService({ ORACLE_READ_API_URL: 'http://oracle-read.test', ORACLE_READ_SCHEMA: 'IAS20262' }));
    await reader.warehouseExists('101');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('schema=IAS20262'), expect.anything());
  });

  it('discovers transfer documents by OUT_REQ_SER using the SELECT-only gateway', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ documents: [{ transferSerial: '202600000111131' }] }),
    } as Response);
    const reader = new ReadOnlyOracleHttpReader(new ConfigService({ ORACLE_READ_API_URL: 'http://oracle-read.test' }));
    await expect(reader.transferDocumentsByOutRequest('20260000015')).resolves.toEqual([
      { transferSerial: '202600000111131' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://oracle-read.test/inventory/transfers/by-out-request?outReqSer=20260000015&schema=IAS20261',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('fails closed when the read-only gateway is not configured', async () => {
    const reader = new ReadOnlyOracleHttpReader(new ConfigService({}));
    await expect(reader.warehouseExists('W1')).rejects.toThrow('غير مهيأة');
  });

  it('allows direct lookup reads for the configured allowlisted schema only when explicitly enabled', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ snapshotRunId: 'live:IAS20261', items: [] }) } as Response);
    const enabled = new ReadOnlyOracleHttpReader(new ConfigService({
      ORACLE_READ_API_URL: 'http://oracle-read.test', ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_TEST_DIRECT_LOOKUPS_ENABLED: 'true',
    }));
    await expect(enabled.directItems('حديد', 20)).resolves.toEqual(expect.objectContaining({ snapshotRunId: 'live:IAS20261' }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/inventory/items?limit=20&search='), expect.objectContaining({ method: 'GET' }));

    const disabled = new ReadOnlyOracleHttpReader(new ConfigService({
      ORACLE_READ_API_URL: 'http://oracle-read.test', ORACLE_READ_SCHEMA: 'IAS20261',
    }));
    await expect(disabled.directWarehouses()).rejects.toThrow('غير مفعلة');
  });

  it('recognizes the verified completed transfer through DOC_SER and the linked destination document', () => {
    expect(transferStatusFromEvidence({
      source: { transferSerial: '20260000011119', transferDocumentNumber: '9', warehouseCode: '102', destinationWarehouseCode: '101', trPost: null, stkProcessed: 0, postDate: null },
      destinationDocuments: [{ transferSerial: '20260000011129', sourceTransferSerial: '20260000011119', warehouseCode: '101' }],
      movements: [
        { documentSerial: '20260000011119', documentType: 7, itemCode: '295602501014', warehouseCode: '102' },
        { documentSerial: '20260000011129', documentType: 8, itemCode: '295602501014', warehouseCode: '101' },
      ],
    }, ['295602501014'])).toEqual(expect.objectContaining({ sourceIssued: true, destinationReceived: true, transferCompleted: true, destinationTransferSerial: '20260000011129' }));
  });

  it('does not treat a source row whose F_TR_SER equals itself as a destination', () => {
    expect(transferStatusFromEvidence({
      source: { transferSerial: '202600000111130', transferDocumentNumber: '30', warehouseCode: '102', destinationWarehouseCode: '101', trPost: null, stkProcessed: 0, postDate: null },
      destinationDocuments: [{ transferSerial: '202600000111130', sourceTransferSerial: '202600000111130', warehouseCode: '102' }],
      movements: [{ documentSerial: '202600000111130', documentType: 7, itemCode: '111100401003', warehouseCode: '102' }],
    }, ['111100401003'])).toEqual(expect.objectContaining({ sourceIssued: true, destinationReceived: false, transferCompleted: false, destinationTransferSerial: null }));
  });

  it('requires movement evidence for every requested item', () => {
    expect(transferStatusFromEvidence({
      source: { transferSerial: '1', transferDocumentNumber: '1', warehouseCode: '102', destinationWarehouseCode: '101', trPost: 1, stkProcessed: 1, postDate: '2026-08-23' },
      destinationDocuments: [],
      movements: [{ documentSerial: '1', documentType: 7, itemCode: 'A', warehouseCode: '102' }],
    }, ['A', 'B'])).toEqual(expect.objectContaining({ sourceIssued: false, transferCompleted: false }));
  });
});
