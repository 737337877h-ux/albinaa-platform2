import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OracleTestRequestsService } from './oracle-test-requests.service';
import { OracleTestRequestsController } from './oracle-test-requests.controller';

const actor = { id: 'user-6', organizationId: 'org-1', permissions: ['oracle_test_requests.receipt.create'] } as never;
const input = { kind: 'receipt', collectorNo: null, recipientName: 'عميل', externalReference: 'same-reference',
  lines: [{ analyticalType: 3, analyticalAccountCode: '20504', currencyCode: 'YR', amount: 10000 }] };

function fixture() {
  const prisma = {
    customer: { findFirst: jest.fn().mockResolvedValue({ assignments: [{ collector: { active: true, oracleCollectorNo: 6 } }] }) },
    collector: { findFirst: jest.fn().mockResolvedValue({ id: 'collector-6', oracleCollectorNo: 6 }) },
  };
  const config = { get: (key: string) => ({ ORACLE_READ_SCHEMA: 'IAS20261', ORACLE_IAS20261_RECEIPT_WRITE_ENABLED: 'true',
    ORACLE_IAS20261_RECEIPT_WRITE_SCHEMA: 'IAS20261', ORACLE_IAS20261_RECEIPT_WRITE_API_URL: 'http://writer.test',
    ORACLE_IAS20261_RECEIPT_WRITE_API_KEY: 'test' })[key] } as ConfigService;
  const subject = new OracleTestRequestsService(config, prisma as never);
  return { subject, prisma, normalize: (payload = input, user = actor) => (subject as any).voucherWriterPayload(payload, user) };
}

describe('server-side receipt collector binding', () => {
  it('fills null from the current scoped assignment even without mobile customer metadata', async () => {
    const { normalize, prisma } = fixture();
    expect((await normalize()).collectorNo).toBe(6);
    expect(input.collectorNo).toBeNull();
    expect(prisma.customer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1', externalCustomerCode: '20504' },
    }));
    expect(prisma.collector.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { oracleCollectorNo: 6, active: true, user: { organizationId: 'org-1', isActive: true } },
    }));
  });

  it('uses the linked creator when the customer has no current assignment', async () => {
    const { normalize, prisma } = fixture();
    prisma.customer.findFirst.mockResolvedValue(null as never);
    expect((await normalize()).collectorNo).toBe(6);
    expect(prisma.collector.findFirst.mock.calls[0][0].where).toEqual({
      userId: 'user-6', active: true, user: { organizationId: 'org-1', isActive: true },
    });
  });

  it('preserves an explicitly selected active collector, including Arabic digits', async () => {
    const { normalize, prisma } = fixture();
    expect((await normalize({ ...input, collectorNo: '٢' } as never)).collectorNo).toBe(2);
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    expect(prisma.collector.findFirst.mock.calls[0][0].where.oracleCollectorNo).toBe(2);
  });

  it.each([0, -1, 1.5, 'bad', true])('rejects invalid collector %s instead of silently replacing it', async number => {
    const { normalize } = fixture();
    await expect(normalize({ ...input, collectorNo: number } as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a missing mapping and inactive or foreign-organization collectors before any writer call', async () => {
    const { normalize, prisma, subject } = fixture();
    prisma.customer.findFirst.mockResolvedValue(null as never);
    prisma.collector.findFirst.mockResolvedValue(null as never);
    await expect(normalize()).rejects.toBeInstanceOf(BadRequestException);
    await expect(normalize({ ...input, collectorNo: 9 } as never)).rejects.toBeInstanceOf(BadRequestException);
    jest.spyOn(subject as any, 'receiptFollowupPlan').mockResolvedValue(null);
    const write = jest.spyOn(subject as any, 'receiptWriteCall');
    await expect(subject.voucherCreate(input, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(write).not.toHaveBeenCalled();
  });

  it('fails closed without an authenticated actor and leaves payment vouchers unchanged', async () => {
    const { normalize, subject } = fixture();
    await expect((subject as any).voucherWriterPayload(input)).rejects.toBeInstanceOf(BadRequestException);
    expect((await normalize({ ...input, kind: 'payment' } as never)).collectorNo).toBeNull();
  });

  it.each([null, undefined, ''])('resolves an omitted or empty collector (%s)', async value => {
    const { normalize } = fixture();
    expect((await normalize({ ...input, collectorNo: value } as never)).collectorNo).toBe(6);
  });

  it('sends the resolved collector and verifies it from Oracle, including idempotent old requests', async () => {
    const { subject } = fixture();
    jest.spyOn(subject as any, 'receiptFollowupPlan').mockResolvedValue(null);
    const write = jest.spyOn(subject as any, 'receiptWriteCall').mockResolvedValue({
      requestNo: '98', requestSerial: '202600000100092100000000981', schema: 'IAS20261', created: true,
    });
    const read = jest.spyOn(subject as any, 'readCall').mockResolvedValue({
      request: { REQUEST_SERIAL: '202600000100092100000000981', VOUCHER_TYPE: 1, COLLECTOR_NO: '6' },
      lines: [{}], approvals: [{ DOCUMENT_TYPE: 92 }],
    });
    expect(await subject.voucherCreate(input, actor)).toEqual(expect.objectContaining({ collectorNo: 6, verified: true }));
    expect(write).toHaveBeenCalledWith('/accounting/receipts', expect.objectContaining({ collectorNo: 6, externalReference: 'same-reference' }));
    read.mockResolvedValue({ request: { REQUEST_SERIAL: '202600000100092100000000981', VOUCHER_TYPE: 1, COLLECTOR_NO: null },
      lines: [{}], approvals: [{ DOCUMENT_TYPE: 92 }] });
    await expect(subject.voucherCreate(input, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('records and notifies the effective collector rather than the mobile null value', async () => {
    const requests = { voucherCreate: jest.fn().mockResolvedValue({ collectorNo: 6, schema: 'IAS20261', requestNo: '98' }) };
    const audit = { log: jest.fn() }, notifications = { notifyByPermissions: jest.fn() };
    const controller = new OracleTestRequestsController(requests as never, audit as never, {} as never, notifications as never);
    await controller.voucherCreate(input, actor, {} as never);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ newValue: expect.objectContaining({ collectorNo: 6 }) }));
    expect(notifications.notifyByPermissions.mock.calls[0][3].collectorNo).toBe(6);
  });
});
