import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeOracleDocumentNumber, OracleTestRequestsService } from './oracle-test-requests.service';

function service(values: Record<string, string>, prisma?: unknown) {
  return new OracleTestRequestsService(
    { get: (key: string) => values[key] } as ConfigService,
    prisma as never,
  );
}

describe('OracleTestRequestsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('normalizes Arabic digits before passing document numbers to Oracle gateways', () => {
    expect(normalizeOracleDocumentNumber('١٧٨٨٩٢٩۶۹۵۲۰۰۴')).toBe('17889296952004');
  });

  it('maps the current platform assignment to the IAS20261 collector number', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      schema: 'IAS20261',
      collectors: [{ code: '1', nameAr: 'المحصل التجريبي الأول', commissionPercent: 2 }],
      parties: {
        customers: [{ code: '30124', nameAr: 'عميل اختبار', linkedAccounts: [], assignedCollector: null }],
      },
    }), { status: 200 }));
    const findMany = jest.fn().mockResolvedValue([{
      externalCustomerCode: '30124',
      assignments: [{ collector: { active: true, oracleCollectorNo: 1, user: { fullName: 'المحصل التجريبي الأول' } } }],
    }]);
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key', ORACLE_READ_SCHEMA: 'IAS20261',
    }, { customer: { findMany } });

    const result = await subject.catalog('receipt', { organizationId: 'org-1' } as never) as Record<string, any>;

    expect(result.parties.customers[0].assignedCollector).toEqual(expect.objectContaining({
      code: '1', nameAr: 'المحصل التجريبي الأول', commissionPercent: 2,
    }));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1', externalCustomerCode: { in: ['30124'] } },
    }));
  });

  it('adds the platform collector name to created receipt requests', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      mode: 'SELECT_ONLY', schema: 'IAS20261',
      items: [
        { kind: 'receipt', requestNo: '2', requestSerial: '22', collectorNo: null, platformCustomerCode: '30124' },
        { kind: 'receipt', requestNo: '3', requestSerial: '33', collectorNo: null, platformCustomerCode: null },
      ],
    }), { status: 200 }));
    const collectorFindMany = jest.fn().mockResolvedValue([{
      id: 'collector-1', oracleCollectorNo: 1, user: { fullName: 'المحصل التجريبي الأول' },
    }]);
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key', ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_IAS20261_RECEIPT_WRITE_ENABLED: 'true',
    }, {
      collector: { findMany: collectorFindMany },
      customer: { findMany: jest.fn().mockResolvedValue([{
        externalCustomerCode: '30124',
        assignments: [{ collector: { id: 'collector-1', active: true, oracleCollectorNo: 1, user: { fullName: 'المحصل التجريبي الأول' } } }],
      }]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([{
        entityId: '33',
        user: { collector: { id: 'collector-6', active: true, oracleCollectorNo: 6, user: { fullName: 'مدير النظام' } } },
      }]) },
      attachment: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const result = await subject.created(
      ['oracle_test_requests.receipt.read'],
      { organizationId: 'org-1' } as never,
    ) as Record<string, any>;

    expect(result.items[0]).toEqual(expect.objectContaining({
      kind: 'receipt', collectorNo: '1', collectorName: 'المحصل التجريبي الأول', collectorId: 'collector-1',
    }));
    expect(result.items[1]).toEqual(expect.objectContaining({
      kind: 'receipt', collectorNo: '6', collectorName: 'مدير النظام', collectorId: 'collector-6',
    }));
  });

  it('combines an approved Oracle receipt with its durable amount and currency', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      mode: 'SELECT_ONLY', schema: 'IAS20261', items: [{
        kind: 'receipt', requestNo: '2', requestSerial: '22', status: 'approved',
        platformCustomerCode: '20318', collectorNo: '2',
      }],
    }), { status: 200 }));
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key', ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_IAS20261_RECEIPT_WRITE_ENABLED: 'true',
    }, {
      collector: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { findMany: jest.fn()
        .mockResolvedValueOnce([{
          id: 'audit-1', entityId: '22', createdAt: new Date('2026-08-31T17:32:37Z'),
          newValue: {
            kind: 'voucher', requestKind: 'receipt', requestNo: '2', requestSerial: '22',
            amount: 17_000, currencyCode: 'YR', recipientName: 'عميل التحصيل',
          },
        }])
        .mockResolvedValueOnce([]) },
      attachment: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const result = await subject.created(
      ['oracle_test_requests.receipt.read'], { organizationId: 'org-1' } as never,
    ) as Record<string, any>;

    expect(result.items[0]).toEqual(expect.objectContaining({
      requestSerial: '22', status: 'approved', amount: 17_000,
      currencyCode: 'YER', recipientName: 'عميل التحصيل', platformCustomerCode: '20318',
    }));
  });

  it('fills a missing receipt recipient name from the linked platform customer', async () => {
    const findFirst = jest.fn().mockResolvedValue({ name: 'عميل التحصيل' });
    const subject = service({}, { customer: { findFirst }, collector: { findFirst: jest.fn().mockResolvedValue({ id: 'collector-1' }) } });

    await expect((subject as any).voucherWriterPayload({
      kind: 'receipt', collectorNo: 1, recipientName: null, platformCustomerCode: '30124', lines: [],
    }, { id: 'user-1', organizationId: 'org-1' })).resolves.toEqual(expect.objectContaining({
      kind: 'receipt', recipientName: 'عميل التحصيل', lines: [],
    }));
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1', externalCustomerCode: '30124' },
      select: { name: true },
    }));
  });

  it('reads currencies from IAS20261 without calling the IAS20191 writer', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema: 'IAS20261', currencies: [],
    }), { status: 200 }));
    const subject = service({
      ORACLE_WRITE_ENABLED: 'true', ORACLE_WRITE_API_URL: 'http://writer.test', ORACLE_WRITE_API_KEY: 'key',
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key', ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_TEST_READ_SCHEMA: 'IAS20191', ORACLE_WRITE_SCHEMA: 'IAS20191',
    });
    await expect(subject.currencies()).resolves.toEqual(expect.objectContaining({ schema: 'IAS20261', oracleWrite: 'NONE' }));
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://reader.test/accounting/currencies?schema=IAS20261', expect.objectContaining({ method: 'GET' }),
    );
  });

  it('retries a transient Oracle read gateway disconnect before failing the mobile request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        mode: 'SELECT_ONLY', schema: 'IAS20261', currencies: [],
      }), { status: 200 }));
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key', ORACLE_READ_SCHEMA: 'IAS20261',
    });

    await expect(subject.currencies()).resolves.toEqual(expect.objectContaining({ schema: 'IAS20261' }));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('checks purchase items and warehouse through IAS20261 without calling the writer', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/inventory/stock?')) return new Response(JSON.stringify({
        warehouseExists: true, itemExists: true, unitExists: true, packageSize: 1, availableQuantity: 12,
      }), { status: 200 });
      if (url.includes('/inventory/items/111100101001?')) return new Response(JSON.stringify({
        nameAr: 'صنف شراء تجريبي', nameEn: null,
      }), { status: 200 });
      return new Response(JSON.stringify({ message: 'unexpected request' }), { status: 500 });
    });
    const subject = service({
      ORACLE_WRITE_ENABLED: 'true', ORACLE_WRITE_API_URL: 'http://writer.test/', ORACLE_WRITE_API_KEY: 'key',
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key',
      ORACLE_READ_SCHEMA: 'IAS20261', ORACLE_TEST_READ_SCHEMA: 'IAS20191', ORACLE_WRITE_SCHEMA: 'IAS20191',
    });
    await expect(subject.purchaseDryRun({
      warehouseCode: '101', requestSide: 'منصة البناء الراقي', notes: 'طلب شراء',
      lines: [{ itemCode: '111100101001', unitCode: 'حبة', quantity: 3 }],
    })).resolves.toEqual(expect.objectContaining({
      valid: true, oracleWrite: 'NONE', schema: 'IAS20261', draftSchema: null, saveAllowed: false,
      issues: [expect.objectContaining({ code: 'IAS20261_PURCHASE_WRITER_DISABLED' })],
      warehouseCode: '101', lines: [expect.objectContaining({ itemNameAr: 'صنف شراء تجريبي', availableQuantity: 12 })],
    }));
    await expect(subject.purchaseCreate({})).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('http://reader.test/inventory/stock?schema=IAS20261'), expect.objectContaining({ method: 'GET' }));
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('http://writer.test'), expect.anything());
  });

  it('enables purchase saving only after both IAS20261 read and the dedicated writer dry-run succeed', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/inventory/stock?')) return new Response(JSON.stringify({
        warehouseExists: true, itemExists: true, unitExists: true, packageSize: 1, availableQuantity: 12,
      }), { status: 200 });
      if (url.includes('/inventory/items/111100101001?')) return new Response(JSON.stringify({
        nameAr: 'صنف شراء تشغيلي', nameEn: null,
      }), { status: 200 });
      if (url === 'http://ias20261-writer.test/purchasing/requests/dry-run') return new Response(JSON.stringify({
        valid: true, mode: 'DRY_RUN', oracleWrite: 'NONE', schema: 'IAS20261', saveAllowed: true,
      }), { status: 200 });
      if (url === 'http://ias20261-writer.test/purchasing/requests') return new Response(JSON.stringify({
        created: true, requestNo: '4', requestSerial: '20260000014', schema: 'IAS20261',
      }), { status: 201 });
      if (url === 'http://reader.test/requests/purchases/20260000014?schema=IAS20261') return new Response(JSON.stringify({
        mode: 'SELECT_ONLY', schema: 'IAS20261',
        request: { REQUEST_NO: '4', REQUEST_SERIAL: '20260000014' },
        lines: [{ LINE_NO: 1, ITEM_CODE: '111100101001' }],
        approvals: [{ DOCUMENT_TYPE: 40, APPROVED: 0 }],
      }), { status: 200 });
      return new Response(JSON.stringify({ message: 'unexpected request' }), { status: 500 });
    });
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key', ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_TEST_READ_SCHEMA: 'IAS20191', ORACLE_WRITE_SCHEMA: 'IAS20191',
      ORACLE_IAS20261_PURCHASE_WRITE_ENABLED: 'true',
      ORACLE_IAS20261_PURCHASE_WRITE_API_URL: 'http://ias20261-writer.test/',
      ORACLE_IAS20261_PURCHASE_WRITE_API_KEY: 'purchase-key',
      ORACLE_IAS20261_PURCHASE_WRITE_SCHEMA: 'IAS20261',
    });
    const payload = {
      externalReference: 'platform-purchase:test', warehouseCode: '101', requestSide: 'المنصة', notes: 'طلب شراء',
      lines: [{ itemCode: '111100101001', unitCode: 'حبة', quantity: 3 }],
    };
    await expect(subject.purchaseDryRun(payload)).resolves.toEqual(expect.objectContaining({
      valid: true, schema: 'IAS20261', draftSchema: 'IAS20261', saveAllowed: true,
    }));
    await expect(subject.purchaseCreate(payload)).resolves.toEqual(expect.objectContaining({
      created: true, requestNo: '4', schema: 'IAS20261', verified: true,
    }));
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://ias20261-writer.test/purchasing/requests/dry-run',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer purchase-key' }) }),
    );
  });

  it('blocks receipt saving until the dedicated IAS20261 writer is enabled', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const subject = service({
      ORACLE_WRITE_ENABLED: 'true', ORACLE_WRITE_API_URL: 'http://writer.test', ORACLE_WRITE_API_KEY: 'key',
      ORACLE_READ_SCHEMA: 'IAS20261', ORACLE_TEST_READ_SCHEMA: 'IAS20191', ORACLE_WRITE_SCHEMA: 'IAS20191',
    });
    await expect(subject.voucherCreate({ kind: 'receipt', referenceNo: '123' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('balances different document and party currencies using IAS20261 system rates without writing', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const body = url.includes('/accounting/currencies') ? {
        mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema: 'IAS20261', currencies: [
          { code: 'SR', nameAr: 'ريال سعودي', rate: '1', local: true, fractionDigits: 2 },
          { code: 'YR', nameAr: 'ريال يمني', rate: '0.0071428571428571', local: false, fractionDigits: 1 },
        ],
      } : {
        mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema: 'IAS20261',
        cashboxes: [{ code: '101', currencyCodes: ['SR', 'YR'] }], banks: [],
        parties: { customers: [{ code: '10002', linkedAccounts: [{
          accountCode: '112101001', analyticalAccountCode: '10002', analyticalType: 3, currencyCodes: ['SR', 'YR'],
        }] }] },
      };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key', ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_TEST_READ_SCHEMA: 'IAS20191', ORACLE_WRITE_SCHEMA: 'IAS20191',
    });
    await expect(subject.voucherDryRun({
      kind: 'receipt', paymentMethod: 'cash', cashOrBankNo: 101, currencyCode: 'SR', amount: 1,
      lines: [{ currencyCode: 'YR', amount: 140, accountCode: '112101001', analyticalAccountCode: '10002', analyticalType: 3 }],
    })).resolves.toEqual(expect.objectContaining({
      valid: true, oracleWrite: 'NONE', schema: 'IAS20261', saveAllowed: false,
      localAmount: 1, counterpartyLocalAmount: 1, localBalance: 0, localCurrency: 'SR',
      lines: [expect.objectContaining({ currencyCode: 'YR', exchangeRate: 0.0071428571428571, localAmount: 1 })],
    }));
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://reader.test/accounting/currencies?schema=IAS20261', expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('http://writer.test'), expect.anything());
  });

  it('enables payment saving only after IAS20261 writer checks, then verifies readback', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'http://reader.test/accounting/currencies?schema=IAS20261') return new Response(JSON.stringify({
        schema: 'IAS20261', currencies: [
          { code: 'SR', nameAr: 'ريال سعودي', rate: '1', local: true, fractionDigits: 2 },
          { code: 'YR', nameAr: 'ريال يمني', rate: '0.0071428571428571', local: false, fractionDigits: 2 },
        ],
      }), { status: 200 });
      if (url.includes('/requests/catalog?')) return new Response(JSON.stringify({
        schema: 'IAS20261', cashboxes: [{ code: '101', currencyCodes: ['SR'] }], banks: [],
        parties: { customers: [{ code: '10001', linkedAccounts: [{
          accountCode: '112101001', analyticalAccountCode: '10001', analyticalType: 3, currencyCodes: ['YR'],
        }] }] },
      }), { status: 200 });
      if (url === 'http://payment-writer.test/accounting/payments/dry-run') return new Response(JSON.stringify({
        valid: true, mode: 'DRY_RUN', oracleWrite: 'NONE', schema: 'IAS20261',
        saveAllowed: true, issues: [],
        voucherType: 2, approvalDocumentType: 93,
      }), { status: 200 });
      if (url === 'http://payment-writer.test/accounting/payments') return new Response(JSON.stringify({
        created: true, requestNo: '6', requestSerial: '202600000100093100000000061',
        schema: 'IAS20261', oracleWrite: 'INSERT_ONLY',
      }), { status: 201 });
      if (url === 'http://reader.test/requests/payments/202600000100093100000000061?schema=IAS20261') {
        return new Response(JSON.stringify({
          schema: 'IAS20261',
          request: { REQUEST_NO: '6', REQUEST_SERIAL: '202600000100093100000000061', VOUCHER_TYPE: '2' },
          lines: [{ LINE_NO: 1, ACCOUNT_CODE: '112101001', LOCAL_AMOUNT: 1 }],
          approvals: [{ DOCUMENT_TYPE: 93, APPROVED: 0 }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `unexpected request: ${url}` }), { status: 500 });
    });
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key', ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_IAS20261_PAYMENT_WRITE_ENABLED: 'true',
      ORACLE_IAS20261_PAYMENT_WRITE_API_URL: 'http://payment-writer.test/',
      ORACLE_IAS20261_PAYMENT_WRITE_API_KEY: 'payment-key',
      ORACLE_IAS20261_PAYMENT_WRITE_SCHEMA: 'IAS20261',
    });
    const payload = {
      kind: 'payment', paymentMethod: 'cash', externalReference: 'payment:test-1',
      cashOrBankNo: 101, currencyCode: 'SR', amount: 1, description: 'اختبار سند صرف',
      recipientName: 'مستلم تجريبي',
      lines: [{
        currencyCode: 'YR', amount: 140, accountCode: '112101001',
        analyticalAccountCode: '10001', analyticalType: 3,
      }],
    };
    await expect(subject.voucherDryRun(payload)).resolves.toEqual(expect.objectContaining({
      valid: true, oracleWrite: 'NONE', schema: 'IAS20261', validationSchema: 'IAS20261',
      draftSchema: 'IAS20261', saveAllowed: true, voucherType: 2, approvalDocumentType: 93,
    }));
    await expect(subject.voucherCreate(payload)).resolves.toEqual(expect.objectContaining({
      created: true, requestNo: '6', schema: 'IAS20261', verified: true,
    }));
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://payment-writer.test/accounting/payments/dry-run',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer payment-key' }) }),
    );
  });

  it('enables receipt saving only after IAS20261 catalog and restricted writer checks, then verifies readback', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'http://reader.test/accounting/currencies?schema=IAS20261') return new Response(JSON.stringify({
        schema: 'IAS20261', currencies: [
          { code: 'SR', nameAr: 'ريال سعودي', rate: '1', local: true, fractionDigits: 2 },
        ],
      }), { status: 200 });
      if (url.includes('/requests/catalog?')) return new Response(JSON.stringify({
        schema: 'IAS20261', cashboxes: [{ code: '101', currencyCodes: ['SR'] }], banks: [],
        parties: { customers: [{ code: '10001', linkedAccounts: [{
          accountCode: '112101001', analyticalAccountCode: '10001', analyticalType: 3, currencyCodes: ['SR'],
        }] }] },
      }), { status: 200 });
      if (url === 'http://ias20261-writer.test/accounting/receipts/dry-run') return new Response(JSON.stringify({
        valid: true, mode: 'DRY_RUN', oracleWrite: 'NONE', schema: 'IAS20261', saveAllowed: true,
        localAmount: 1, counterpartyLocalAmount: 1, localBalance: 0,
      }), { status: 200 });
      if (url === 'http://ias20261-writer.test/accounting/receipts') return new Response(JSON.stringify({
        created: true, requestNo: '6', requestSerial: '202600000100092100000000061', schema: 'IAS20261',
      }), { status: 201 });
      if (url === 'http://reader.test/requests/receipts/202600000100092100000000061?schema=IAS20261') {
        return new Response(JSON.stringify({
          schema: 'IAS20261',
          request: { REQUEST_NO: '6', REQUEST_SERIAL: '202600000100092100000000061', VOUCHER_TYPE: '1', COLLECTOR_NO: '1' },
          lines: [{ LINE_NO: 1, ACCOUNT_CODE: '112101001' }],
          approvals: [{ DOCUMENT_TYPE: 92, APPROVED: 0 }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `unexpected request: ${url}` }), { status: 500 });
    });
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key', ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_IAS20261_RECEIPT_WRITE_ENABLED: 'true',
      ORACLE_IAS20261_RECEIPT_WRITE_API_URL: 'http://ias20261-writer.test/',
      ORACLE_IAS20261_RECEIPT_WRITE_API_KEY: 'receipt-key',
      ORACLE_IAS20261_RECEIPT_WRITE_SCHEMA: 'IAS20261',
    }, {
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
      collector: { findFirst: jest.fn().mockResolvedValue({ id: 'collector-1', oracleCollectorNo: 1 }) },
    });
    const payload = {
      kind: 'receipt', paymentMethod: 'cash', externalReference: 'receipt:test-1',
      cashOrBankNo: 101, currencyCode: 'SR', amount: 1, description: 'اختبار سند قبض',
      referenceNo: 'TEST-1', noticeNo: null, collectorNo: null, commissionPercent: null,
      lines: [{
        currencyCode: 'SR', amount: 1, accountCode: '112101001',
        analyticalAccountCode: '10001', analyticalType: 3, description: 'تحصيل',
      }],
    };
    const actor = { id: 'user-1', organizationId: 'org-1' } as never;
    await expect(subject.voucherDryRun(payload, actor)).resolves.toEqual(expect.objectContaining({
      valid: true, schema: 'IAS20261', draftSchema: 'IAS20261', saveAllowed: true,
    }));
    await expect(subject.voucherCreate(payload, actor)).resolves.toEqual(expect.objectContaining({
      created: true, requestNo: '6', schema: 'IAS20261', verified: true,
    }));
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://ias20261-writer.test/accounting/receipts/dry-run',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer receipt-key' }) }),
    );
  });

  it('rejects a party currency that is not configured for the linked IAS20261 account', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const body = url.includes('/accounting/currencies') ? {
        currencies: [
          { code: 'SR', nameAr: 'ريال سعودي', rate: '1', local: true, fractionDigits: 2 },
          { code: 'YR', nameAr: 'ريال يمني', rate: '0.0071428571428571', local: false, fractionDigits: 1 },
        ],
      } : {
        cashboxes: [{ code: '101', currencyCodes: ['SR'] }], banks: [],
        parties: { customers: [{ code: '10002', linkedAccounts: [{
          accountCode: '112101001', analyticalAccountCode: '10002', analyticalType: 3, currencyCodes: ['SR'],
        }] }] },
      };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key', ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_TEST_READ_SCHEMA: 'IAS20191', ORACLE_WRITE_SCHEMA: 'IAS20191',
    });
    const result = await subject.voucherDryRun({
      kind: 'receipt', paymentMethod: 'cash', cashOrBankNo: 101, currencyCode: 'SR', amount: 1,
      lines: [{ currencyCode: 'YR', amount: 140, accountCode: '112101001', analyticalAccountCode: '10002', analyticalType: 3 }],
    }) as Record<string, any>;
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PARTY_ACCOUNT_CURRENCY_NOT_ALLOWED', severity: 'error' }),
    ]));
  });

  it('loads the IAS20261 catalog through the SELECT-only gateway without enabling writes', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      mode: 'SELECT_ONLY', schema: 'IAS20261', cashboxes: [], banks: [], parties: {}, collectors: [],
    }), { status: 200 }));
    const subject = service({
      ORACLE_WRITE_ENABLED: 'false', ORACLE_READ_API_URL: 'http://reader.test/', ORACLE_READ_API_KEY: 'read-key',
      ORACLE_READ_SCHEMA: 'IAS20261',
    });
    await expect(subject.catalog('receipt')).resolves.toEqual(expect.objectContaining({ mode: 'SELECT_ONLY' }));
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://reader.test/requests/catalog?schema=IAS20261&purpose=receipt&oracleUserId=1&branchNo=1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('fills the confirmed IAS20191 customer account when the read catalog has no analytical row', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      mode: 'SELECT_ONLY', schema: 'IAS20191', cashboxes: [], banks: [], collectors: [],
      parties: { customers: [{ code: '20067', nameAr: 'ابراهيم احمد الهميس', linkedAccounts: [] }] },
    }), { status: 200 }));
    const subject = service({
      ORACLE_WRITE_ENABLED: 'false', ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key',
      ORACLE_READ_SCHEMA: 'IAS20191',
    });
    const result = await subject.catalog('receipt') as Record<string, any>;
    expect(result.parties.customers[0].linkedAccounts).toEqual([{
      accountCode: '112101001', accountName: 'العملاء',
      analyticalAccountCode: '20067', analyticalAccountName: 'ابراهيم احمد الهميس', analyticalType: 3,
      currencyCodes: [],
    }]);
  });

  it('filters created Oracle requests by the caller read permissions', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      mode: 'SELECT_ONLY', schema: 'IAS20191', items: [
        { kind: 'purchase', requestNo: '3' },
        { kind: 'receipt', requestNo: '4' },
        { kind: 'inventory_transfer', requestNo: '5' },
      ],
    }), { status: 200 }));
    const subject = service({
      ORACLE_TEST_READ_API_URL: 'http://test-reader.test/', ORACLE_TEST_READ_API_KEY: 'test-read-key',
      ORACLE_TEST_READ_SCHEMA: 'IAS20191',
    });
    const result = await subject.created([
      'oracle_test_requests.receipt.read', 'inventory_transfers.read',
    ]) as Record<string, any>;
    expect(result.items.map((item: Record<string, unknown>) => item.kind)).toEqual(['receipt', 'inventory_transfer']);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://test-reader.test/requests/created?schema=IAS20191&limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('uses IAS20261 for purchase status while retaining other pilot statuses from IAS20191', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('schema=IAS20261')) return new Response(JSON.stringify({
        mode: 'SELECT_ONLY', schema: 'IAS20261', items: [{ kind: 'purchase', requestNo: '4', requestSerial: '20260000014' }],
      }), { status: 200 });
      return new Response(JSON.stringify({
        mode: 'SELECT_ONLY', schema: 'IAS20191', items: [
          { kind: 'purchase', requestNo: '3', requestSerial: '20190000013' },
          { kind: 'receipt', requestNo: '5', requestSerial: '20190000015' },
        ],
      }), { status: 200 });
    });
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key', ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_TEST_READ_API_URL: 'http://test-reader.test', ORACLE_TEST_READ_API_KEY: 'test-key', ORACLE_TEST_READ_SCHEMA: 'IAS20191',
    });
    const result = await subject.created([
      'oracle_test_requests.purchase.read', 'oracle_test_requests.receipt.read',
    ]) as Record<string, any>;
    expect(result.schemas).toEqual(['IAS20261', 'IAS20191']);
    expect(result.items.map((item: Record<string, unknown>) => [item.kind, item.requestNo])).toEqual([
      ['purchase', '4'], ['receipt', '5'],
    ]);
  });

  it('keeps readable IAS20261 statuses when receipt status access is unavailable', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('kind=receipt')) {
        return new Response(JSON.stringify({ message: 'Oracle read is temporarily unavailable' }), { status: 503 });
      }
      return new Response(JSON.stringify({
        mode: 'SELECT_ONLY', schema: 'IAS20261',
        items: [{ kind: 'purchase', requestNo: '4', requestSerial: '20260000014' }],
      }), { status: 200 });
    });
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key', ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_IAS20261_RECEIPT_WRITE_ENABLED: 'true',
      ORACLE_IAS20261_RECEIPT_WRITE_API_URL: 'http://receipt-writer.test',
      ORACLE_IAS20261_RECEIPT_WRITE_API_KEY: 'receipt-key',
      ORACLE_IAS20261_RECEIPT_WRITE_SCHEMA: 'IAS20261',
    });

    const result = await subject.created([
      'oracle_test_requests.purchase.read', 'oracle_test_requests.receipt.read',
    ]) as Record<string, any>;

    expect(result.items.map((item: Record<string, unknown>) => item.kind)).toEqual(['purchase']);
    expect(result.partial).toBe(true);
    expect(result.warnings).toEqual([expect.objectContaining({ kind: 'receipt', schema: 'IAS20261' })]);
  });

  it('loads IAS20261 inventory-transfer statuses for a transfer-only mobile user', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      mode: 'SELECT_ONLY', schema: 'IAS20261',
      items: [{ kind: 'inventory_transfer', requestNo: '7', requestSerial: '20260000017' }],
    }), { status: 200 }));
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key',
      ORACLE_READ_SCHEMA: 'IAS20261',
    });

    const result = await subject.created(['inventory_transfers.read']) as Record<string, any>;

    expect(result.items).toEqual([
      expect.objectContaining({ kind: 'inventory_transfer', requestNo: '7' }),
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://reader.test/requests/created?schema=IAS20261&limit=100&kind=inventory_transfer',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('loads an IAS20261 inventory count only through the operational SELECT-only gateway', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema: 'IAS20261',
      document: { number: '9', processed: false, externalPost: false },
      inventoryType: { viewAllowed: true }, lines: [{ conversionProven: true, processedAdjustment: false }],
    }), { status: 200 }));
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test/', ORACLE_READ_API_KEY: 'read-key',
      ORACLE_READ_SCHEMA: 'IAS20261',
    });
    await expect(subject.inventoryCount({ documentNo: 9, inventoryType: 2, branchNo: 1, branchYear: 2026 }))
      .resolves.toEqual(expect.objectContaining({ mode: 'SELECT_ONLY', oracleWrite: 'NONE' }));
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://reader.test/inventory/counts/9?schema=IAS20261&inventoryType=2&branchNo=1&branchYear=2026&oracleUserId=1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('keeps unproven multi-unit inventory differences as a non-writing Dry Run warning', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema: 'IAS20261',
      document: { number: '9', processed: false, externalPost: false },
      inventoryType: { viewAllowed: true },
      lines: [{ conversionProven: false, processedAdjustment: false }],
    }), { status: 200 }));
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key',
      ORACLE_READ_SCHEMA: 'IAS20261',
    });
    const result = await subject.inventoryCountDryRun({ documentNo: 9, inventoryType: 2, branchNo: 1, branchYear: 2026 }) as Record<string, any>;
    expect(result).toEqual(expect.objectContaining({ valid: true, mode: 'DRY_RUN', oracleWrite: 'NONE' }));
    expect(result.issues).toEqual([expect.objectContaining({ severity: 'warning', code: 'UNPROVEN_UNIT_CONVERSION' })]);
  });

  it('enables native IAS20261 inventory saving only after writer Dry Run, then verifies readback', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const href = String(input);
      if (href.includes('/inventory/stock?')) {
        return new Response(JSON.stringify({
          warehouseExists: true, itemExists: true, unitExists: true, packageSize: 1, availableQuantity: 7,
        }), { status: 200 });
      }
      if (href.includes('/inventory/items/111100101001?')) {
        return new Response(JSON.stringify({ nameAr: 'صنف تجريبي', nameEn: null }), { status: 200 });
      }
      if (href === 'http://inventory-writer.test/inventory/counts/dry-run') {
        return new Response(JSON.stringify({
          valid: true, mode: 'DRY_RUN', oracleWrite: 'NONE', schema: 'IAS20261', saveAllowed: true,
          inventoryType: { code: '2', nameAr: 'جرد من تطبيق البناء الراقي' }, warehouseCode: '101',
          lines: [{
            itemCode: '111100101001', itemNameAr: 'صنف تجريبي', unitCode: 'حبة',
            countedQuantity: 10, availableQuantity: 7, differenceQuantity: 3,
          }],
        }), { status: 200 });
      }
      if (href === 'http://inventory-writer.test/inventory/counts') {
        return new Response(JSON.stringify({
          created: true, documentNo: '9', documentSerial: '2026000002339', inventoryType: '2',
          schema: 'IAS20261', processed: false, externalPost: false,
        }), { status: 201 });
      }
      if (href === 'http://reader.test/inventory/counts/9?schema=IAS20261&inventoryType=2&branchNo=1&branchYear=2026&oracleUserId=1') {
        return new Response(JSON.stringify({
          mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema: 'IAS20261',
          document: { number: '9', processed: false, externalPost: false },
          inventoryType: { viewAllowed: true },
          lines: [{ itemCode: '111100101001', processedAdjustment: false }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `unexpected request: ${href}` }), { status: 500 });
    });
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key',
      ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_IAS20261_INVENTORY_WRITE_ENABLED: 'true',
      ORACLE_IAS20261_INVENTORY_WRITE_API_URL: 'http://inventory-writer.test/',
      ORACLE_IAS20261_INVENTORY_WRITE_API_KEY: 'inventory-key',
      ORACLE_IAS20261_INVENTORY_WRITE_SCHEMA: 'IAS20261',
    });
    const payload = {
      externalReference: 'inventory:test-9', inventoryType: 2, description: 'جرد تجريبي',
      warehouseCode: 101,
      lines: [{ itemCode: '111100101001', unitCode: 'حبة', countedQuantity: 10 }],
    };
    await expect(subject.inventoryCountCreateDryRun(payload)).resolves.toEqual(expect.objectContaining({
      valid: true, oracleWrite: 'NONE', schema: 'IAS20261', referenceSchema: 'IAS20261',
      draftSchema: 'IAS20261', saveAllowed: true, issues: [],
      lines: [expect.objectContaining({ itemNameAr: 'صنف تجريبي', availableQuantity: 7, differenceQuantity: 3 })],
    }));
    await expect(subject.inventoryCountCreate(payload)).resolves.toEqual(expect.objectContaining({
      created: true, documentNo: '9', documentSerial: '2026000002339', schema: 'IAS20261', verified: true,
    }));
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('http://reader.test/inventory/stock?schema=IAS20261'), expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://inventory-writer.test/inventory/counts/dry-run',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer inventory-key' }) }),
    );
  });

  it('reports an inventory draft as saved when Oracle readback is temporarily unavailable', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const href = String(input);
      if (href === 'http://inventory-writer.test/inventory/counts') {
        return new Response(JSON.stringify({
          created: true, documentNo: '10', documentSerial: '20260000023310', inventoryType: '2',
          schema: 'IAS20261', processed: false, externalPost: false,
        }), { status: 201 });
      }
      if (href === 'http://reader.test/inventory/counts/10?schema=IAS20261&inventoryType=2&branchNo=1&branchYear=2026&oracleUserId=1') {
        return new Response(JSON.stringify({ message: 'Oracle read is temporarily unavailable' }), { status: 503 });
      }
      return new Response(JSON.stringify({ message: `unexpected request: ${href}` }), { status: 500 });
    });
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key',
      ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_IAS20261_INVENTORY_WRITE_ENABLED: 'true',
      ORACLE_IAS20261_INVENTORY_WRITE_API_URL: 'http://inventory-writer.test/',
      ORACLE_IAS20261_INVENTORY_WRITE_API_KEY: 'inventory-key',
      ORACLE_IAS20261_INVENTORY_WRITE_SCHEMA: 'IAS20261',
    });
    const result = await subject.inventoryCountCreate({
      externalReference: 'inventory:test-10', inventoryType: 2, description: 'جرد تجريبي',
      warehouseCode: 101,
      lines: [{ itemCode: '111100101001', unitCode: 'حبة', countedQuantity: 10 }],
    }) as Record<string, unknown>;

    expect(result).toEqual(expect.objectContaining({
      created: true,
      documentNo: '10',
      verified: false,
      readbackPending: true,
    }));
    expect(String(result.readbackWarning)).toContain('لا تعِد الحفظ');
  });

  it('Dry Runs an IAS20261 journal from the read catalog and never falls back to IAS20191', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'http://reader.test/accounting/currencies?schema=IAS20261') return new Response(JSON.stringify({
        schema: 'IAS20261', currencies: [
          { code: 'SR', nameAr: 'ريال سعودي', rate: '1', local: true, fractionDigits: 2 },
          { code: 'YR', nameAr: 'ريال يمني', rate: '0.0071428571428571', local: false, fractionDigits: 2 },
        ],
      }), { status: 200 });
      if (url.includes('/requests/catalog?schema=IAS20261')) return new Response(JSON.stringify({
        schema: 'IAS20261', parties: {
          customers: [{ code: '10001', linkedAccounts: [{
            accountCode: '112101001', analyticalAccountCode: '10001', analyticalType: 3, currencyCodes: ['YR'],
          }] }],
          bank_accounts: [{ code: '207', linkedAccounts: [{
            accountCode: '111202007', analyticalAccountCode: '207', analyticalType: 2, currencyCodes: ['SR'],
          }] }],
        },
      }), { status: 200 });
      return new Response(JSON.stringify({ message: `unexpected request: ${url}` }), { status: 500 });
    });
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key', ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_WRITE_ENABLED: 'true', ORACLE_WRITE_API_URL: 'http://ias20191-writer.test',
      ORACLE_WRITE_API_KEY: 'old-key', ORACLE_WRITE_SCHEMA: 'IAS20191',
    });
    const result = await subject.journalDryRun({
      externalReference: 'platform-journal:test-1', description: 'اختبار قيد',
      lines: [
        { direction: 'debit', currencyCode: 'YR', amount: 140, accountCode: '112101001', analyticalAccountCode: '10001', analyticalType: 3 },
        { direction: 'credit', currencyCode: 'SR', amount: 1, accountCode: '111202007', analyticalAccountCode: '207', analyticalType: 2 },
      ],
    }) as Record<string, any>;
    expect(result).toEqual(expect.objectContaining({
      valid: true, schema: 'IAS20261', localCurrency: 'SR', localBalance: 0, saveAllowed: false,
      saveBlockedReason: expect.stringContaining('بوابة الكتابة المقيدة'),
    }));
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('ias20191-writer.test'), expect.anything());
  });

  it('enables IAS20261 journal saving only after writer Dry Run and exact readback succeed', async () => {
    const serial = '2026000001000850018';
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'http://reader.test/accounting/currencies?schema=IAS20261') return new Response(JSON.stringify({
        schema: 'IAS20261', currencies: [{ code: 'SR', nameAr: 'ريال سعودي', rate: '1', local: true, fractionDigits: 2 }],
      }), { status: 200 });
      if (url.includes('/requests/catalog?schema=IAS20261')) return new Response(JSON.stringify({
        schema: 'IAS20261', parties: {
          customers: [{ code: '10001', linkedAccounts: [{
            accountCode: '112101001', analyticalAccountCode: '10001', analyticalType: 3, currencyCodes: ['SR'],
          }] }],
          bank_accounts: [{ code: '207', linkedAccounts: [{
            accountCode: '111202007', analyticalAccountCode: '207', analyticalType: 2, currencyCodes: ['SR'],
          }] }],
        },
      }), { status: 200 });
      if (url === 'http://journal-writer.test/accounting/journals/dry-run') return new Response(JSON.stringify({
        valid: true, schema: 'IAS20261', oracleWrite: 'NONE', saveAllowed: true, localCurrency: 'SR', localBalance: 0,
      }), { status: 200 });
      if (url === 'http://journal-writer.test/accounting/journals') return new Response(JSON.stringify({
        created: true, requestNo: '8', requestSerial: serial, schema: 'IAS20261', oracleWrite: 'INSERT_ONLY',
      }), { status: 201 });
      if (url === `http://reader.test/requests/journals/${serial}?schema=IAS20261`) return new Response(JSON.stringify({
        schema: 'IAS20261',
        request: { REQUEST_NO: '8', REQUEST_SERIAL: serial, JOURNAL_TYPE: '1' },
        lines: [{ LINE_NO: 1 }, { LINE_NO: 2 }], approvals: [{ DOCUMENT_TYPE: 85, APPROVED: 0 }],
      }), { status: 200 });
      return new Response(JSON.stringify({ message: `unexpected request: ${url}` }), { status: 500 });
    });
    const subject = service({
      ORACLE_READ_API_URL: 'http://reader.test', ORACLE_READ_API_KEY: 'read-key', ORACLE_READ_SCHEMA: 'IAS20261',
      ORACLE_IAS20261_JOURNAL_WRITE_ENABLED: 'true',
      ORACLE_IAS20261_JOURNAL_WRITE_API_URL: 'http://journal-writer.test/',
      ORACLE_IAS20261_JOURNAL_WRITE_API_KEY: 'journal-key',
      ORACLE_IAS20261_JOURNAL_WRITE_SCHEMA: 'IAS20261',
    });
    const payload = {
      externalReference: 'platform-journal:test-2', description: 'اختبار قيد',
      lines: [
        { direction: 'debit', currencyCode: 'SR', amount: 1, accountCode: '112101001', analyticalAccountCode: '10001', analyticalType: 3 },
        { direction: 'credit', currencyCode: 'SR', amount: 1, accountCode: '111202007', analyticalAccountCode: '207', analyticalType: 2 },
      ],
    };
    await expect(subject.journalDryRun(payload)).resolves.toEqual(expect.objectContaining({
      valid: true, schema: 'IAS20261', draftSchema: 'IAS20261', saveAllowed: true,
    }));
    await expect(subject.journalCreate(payload)).resolves.toEqual(expect.objectContaining({
      created: true, requestNo: '8', verified: true,
    }));
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://journal-writer.test/accounting/journals/dry-run',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer journal-key' }) }),
    );
  });
});
