import { oracleReceiptActivity } from './oracle-receipt-activity';

it('uses document currency and collector mapping without adding a balance ledger entry', async () => {
  const prisma: any = {
    oracleMovementSyncRun: { findFirst: jest.fn().mockResolvedValue({ id: 'run' }) },
    collector: { findMany: jest.fn().mockResolvedValue([{ id: 'collector', oracleCollectorNo: 2, user: { fullName: 'محصل' } }]) },
    customer: { findMany: jest.fn().mockResolvedValue([{ id: 'customer', externalCustomerCode: '30124', name: 'عميل' }]) },
    collection: { findMany: jest.fn().mockResolvedValue([]) },
    oracleCustomerMovementMirror: { findMany: jest.fn().mockResolvedValue([
      { externalCustomerCode: '30124', collectorNo: '2', documentSerial: '12345678901234567890', documentNumber: '12', currencyCode: 'YR', creditLocal: 1, debitLocal: 0, creditForeign: 140, debitForeign: 0 },
    ]) },
  };
  const result = await oracleReceiptActivity(prisma, { id: 'user', organizationId: 'org', permissions: [] } as any, '2026-09-06');
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ amount: 140, currencyCode: 'YER', referenceNumber: '12345678901234567890', collector: { id: 'collector' } });
  expect(prisma.collector.findMany.mock.calls[0][0].where.userId).toBe('user');
  const receipt = prisma.oracleCustomerMovementMirror.findMany.mock.results[0].value;
  const [row] = await receipt;
  prisma.oracleCustomerMovementMirror.findMany.mockResolvedValue([row, { ...row, creditForeign: 0, debitForeign: 140 }]);
  expect(await oracleReceiptActivity(prisma, { id: 'user', organizationId: 'org', permissions: [] } as any, '2026-09-06')).toEqual([]);
  prisma.oracleCustomerMovementMirror.findMany.mockResolvedValue([row]);
  prisma.collection.findMany.mockResolvedValue([{ referenceNumber: '12345678901234567890', customerId: 'customer', currencyCode: 'YER' }]);
  expect(await oracleReceiptActivity(prisma, { id: 'user', organizationId: 'org', permissions: [] } as any, '2026-09-06')).toEqual([]);
});

it('falls back to the Oracle document number when the serial is empty', async () => {
  const prisma: any = {
    oracleMovementSyncRun: { findFirst: jest.fn().mockResolvedValue({ id: 'run' }) },
    collector: { findMany: jest.fn().mockResolvedValue([{ id: 'collector', oracleCollectorNo: 1, user: { fullName: 'المحصل التجريبي الأول' } }]) },
    customer: { findMany: jest.fn().mockResolvedValue([{ id: 'customer', externalCustomerCode: '20560', name: 'عميل' }]) },
    collection: { findMany: jest.fn().mockResolvedValue([]) },
    oracleCustomerMovementMirror: { findMany: jest.fn().mockResolvedValue([{
      externalCustomerCode: '20560', collectorNo: '1', documentSerial: '', documentNumber: '1420',
      currencyCode: 'YR', creditLocal: 1, debitLocal: 0, creditForeign: 2310000, debitForeign: 0,
      documentDate: new Date('2026-09-07'), description: null,
    }]) },
  };
  const result = await oracleReceiptActivity(prisma, { id: 'admin', organizationId: 'org', permissions: ['customers.read_all'] } as any, '2026-09-07');
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ referenceNumber: '1420', receiptNumber: '1420', amount: 2310000 });
});

describe('Oracle receipts without a collector number', () => {
  function fixture() {
    const row = { externalCustomerCode: '90001', collectorNo: null, documentSerial: '', documentNumber: '7001',
      currencyCode: 'YR', creditLocal: 772.857, debitLocal: 0, creditForeign: 123400, debitForeign: 0,
      documentDate: new Date('2026-10-25'), description: 'دفعة من الحساب' };
    const prisma: any = {
      oracleMovementSyncRun: { findFirst: jest.fn().mockResolvedValue({ id: 'run' }) },
      collector: { findMany: jest.fn().mockResolvedValue([{ id: 'collector-1', oracleCollectorNo: 1, user: { fullName: 'المحصل الأول' } }]) },
      customer: { findMany: jest.fn().mockResolvedValue([{ id: 'customer', externalCustomerCode: '90001', name: 'عميل', assignments: [{ collectorId: 'collector-1' }] }]) },
      collection: { findMany: jest.fn().mockResolvedValue([]) },
      oracleCustomerMovementMirror: { findMany: jest.fn().mockResolvedValue([row]) },
    };
    const actor: any = { id: 'user', organizationId: 'org', permissions: [] };
    return { row, prisma, actor };
  }
  it.each([null, '', '0'])('uses the current platform assignment when COL_NO is %s', async value => {
    const {row,prisma,actor}=fixture();row.collectorNo=value as never;
    const rows=await oracleReceiptActivity(prisma,actor);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({amount:123400,collector:{id:'collector-1'},receiptNumber:'7001'});
    expect(prisma.customer.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({where:expect.objectContaining({organizationId:'org'})}));
  });
  it('does not expose another collector\'s assignment or override an explicit Oracle collector', async () => {
    const {row,prisma,actor}=fixture();
    prisma.customer.findMany.mockResolvedValue([{id:'customer',externalCustomerCode:'90001',name:'عميل',assignments:[{collectorId:'other'}]}]);
    expect(await oracleReceiptActivity(prisma,actor)).toEqual([]);
    prisma.customer.findMany.mockResolvedValue([{id:'customer',externalCustomerCode:'90001',name:'عميل',assignments:[{collectorId:'collector-1'}]}]);
    row.collectorNo='2' as never;
    expect(await oracleReceiptActivity(prisma,actor)).toEqual([]);
  });
  it('does not count the same existing platform collection twice and supports assignment-only collectors', async () => {
    const {prisma,actor}=fixture();
    prisma.collector.findMany.mockResolvedValue([{id:'collector-1',oracleCollectorNo:null,user:{fullName:'محصل'}}]);
    expect(await oracleReceiptActivity(prisma,actor)).toHaveLength(1);
    prisma.collection.findMany.mockResolvedValue([{receiptNumber:'7001',customerId:'customer',currencyCode:'YER'}]);
    expect(await oracleReceiptActivity(prisma,actor)).toEqual([]);
  });
  it('shows an unassigned receipt only in an explicitly requested administrator history view', async () => {
    const {prisma,actor}=fixture();
    const admin={...actor,permissions:['customers.read_all']};
    prisma.customer.findMany.mockResolvedValue([{id:'customer',externalCustomerCode:'90001',name:'عميل',assignments:[]}]);
    expect(await oracleReceiptActivity(prisma,admin)).toEqual([]);
    const history=await oracleReceiptActivity(prisma,admin,undefined,{includeUnassigned:true});
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({amount:123400,collector:{id:null,oracleCollectorNo:null,user:{fullName:'غير مسند'}}});
    expect(prisma.oracleCustomerMovementMirror.findMany.mock.calls.at(-1)[0].where).toMatchObject({organizationId:'org'});
    expect(prisma.oracleCustomerMovementMirror.findMany.mock.calls.at(-1)[0].where.OR).toBeUndefined();
  });
  it('does not let an ordinary collector opt into unassigned or other-collector receipts', async () => {
    const {prisma,actor,row}=fixture();
    prisma.customer.findMany.mockResolvedValue([{id:'customer',externalCustomerCode:'90001',name:'عميل',assignments:[]}]);
    expect(await oracleReceiptActivity(prisma,actor,undefined,{includeUnassigned:true})).toEqual([]);
    row.collectorNo='2' as never;
    expect(await oracleReceiptActivity(prisma,actor,undefined,{includeUnassigned:true})).toEqual([]);
    expect(prisma.collector.findMany.mock.calls.at(-1)[0].where).toMatchObject({userId:'user',user:{organizationId:'org'}});
    expect(prisma.oracleCustomerMovementMirror.findMany.mock.calls.at(-1)[0].where.OR).toBeDefined();
  });
  it('keeps admin history available when there are no active mapped collectors', async () => {
    const {prisma,actor}=fixture();
    prisma.collector.findMany.mockResolvedValue([]);
    prisma.customer.findMany.mockResolvedValue([{id:'customer',externalCustomerCode:'90001',name:'عميل',assignments:[]}]);
    expect(await oracleReceiptActivity(prisma,{...actor,permissions:['customers.read_all']},undefined,{includeUnassigned:true})).toEqual([
      expect.objectContaining({collector:{id:null,oracleCollectorNo:null,user:{fullName:'غير مسند'}}}),
    ]);
  });
});
