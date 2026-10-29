import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalesOrderDraftsService } from './sales-order-drafts.service';

const actor = { id: 'user-1', organizationId: 'org-1', role: 'admin', permissions: [] } as any;

describe('SalesOrderDraftsService', () => {
  const audit = { log: jest.fn() } as any;

  it('lists drafts inside the current organization only', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new SalesOrderDraftsService({ salesOrderDraft: { findMany, count: jest.fn().mockResolvedValue(0) } } as any, audit);
    await service.list(actor);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-1' } }));
  });

  it('does not expose a draft from another organization', async () => {
    const service = new SalesOrderDraftsService({ salesOrderDraft: { findFirst: jest.fn().mockResolvedValue(null) } } as any, audit);
    await expect(service.get(actor, 'draft-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('checks a customer request against IAS20261 mirrors without saving anything', async () => {
    const create = jest.fn();
    const prisma = {
      oracleCustomerSyncRun: { findFirst: jest.fn().mockResolvedValue({ id: 'customers-run' }) },
      oracleInventoryActiveSnapshot: { findUnique: jest.fn().mockResolvedValue({ activeRunId: 'inventory-run' }) },
      oracleCustomerMirror: { findFirst: jest.fn().mockResolvedValue({
        externalCustomerCode: '20027', nameAr: 'عميل تجريبي', mobile: null, phone: null, address: null,
      }) },
      oracleItemUnitMirror: { findFirst: jest.fn().mockResolvedValue({
        packageSize: new Prisma.Decimal(1), item: { nameAr: 'صنف تجريبي', isInactive: false },
        stockRows: [{ externalWarehouseCode: '101', availableQuantity: new Prisma.Decimal(10), isInactive: false }],
      }) },
      salesOrderDraft: { create },
    } as any;
    const service = new SalesOrderDraftsService(prisma, audit);
    const result = await service.dryRun(actor, {
      customerCode: '20027', currencyCode: 'YR', orderDate: '2026-08-28',
      lines: [{ itemCode: '001', unitCode: 'حبة', warehouseCode: '101', quantity: 2, unitPrice: 50 }],
    });
    expect(result).toEqual(expect.objectContaining({
      valid: true, mode: 'DRY_RUN', oracleWrite: 'NONE', sourceSchema: 'IAS20261', targetSchema: 'IAS20191',
    }));
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts a cash customer order by name without a customer code', async () => {
    const prisma = {
      oracleCustomerSyncRun: { findFirst: jest.fn().mockResolvedValue({ id: 'customers-run' }) },
      oracleInventoryActiveSnapshot: { findUnique: jest.fn().mockResolvedValue({ activeRunId: 'inventory-run' }) },
      oracleCustomerMirror: { findFirst: jest.fn() },
      oracleItemUnitMirror: { findFirst: jest.fn().mockResolvedValue({
        packageSize: new Prisma.Decimal(1), item: { nameAr: 'صنف نقدي', isInactive: false },
        stockRows: [{ externalWarehouseCode: '102', availableQuantity: new Prisma.Decimal(5), isInactive: false }],
      }) },
    } as any;
    const service = new SalesOrderDraftsService(prisma, audit);
    const result = await service.dryRun(actor, {
      orderKind: 'cash', customerName: 'عميل نقدي', currencyCode: 'YR', orderDate: '2026-09-01',
      lines: [{ itemCode: 'I1', unitCode: 'حبة', warehouseCode: '102', quantity: 1, unitPrice: 100 }],
    });
    expect(result.customer).toEqual({ code: null, nameAr: 'عميل نقدي' });
    expect(prisma.oracleCustomerMirror.findFirst).not.toHaveBeenCalled();
  });

  it('mirrors cash by name and credit by C_CODE without any Oracle write method', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'draft' });
    const prisma = {
      customer: { findMany: jest.fn().mockResolvedValue([{ externalCustomerCode: '20011', name: 'عميل آجل' }]) },
      salesOrderDraft: { findUnique: jest.fn().mockResolvedValue(null), upsert },
    } as any;
    const reader = { page: jest.fn().mockResolvedValue({
      mode: 'SELECT_ONLY', oracleWrite: 'NONE', schema: 'IAS20261', nextAfterSerial: null,
      items: [
        {
          orderNo: '1', orderSerial: '20260001', orderDate: '2026-09-01', kind: 'cash', billDocumentType: '1',
          currencyCode: 'YER', amount: '100', customerCode: null, customerName: 'عميل نقدي', customerMobile: null,
          customerAddress: null, customerBindingStatus: 'cash_name_only', approved: false, processed: false,
          updatedAt: null, lines: [{ lineNo: 1, itemCode: 'I1', itemName: 'صنف', unitCode: 'حبة', quantity: '1', packageSize: '1', unitPrice: '100', warehouseCode: '101', cancelled: false }],
        },
        {
          orderNo: '2', orderSerial: '20260002', orderDate: '2026-09-01', kind: 'credit', billDocumentType: '4',
          currencyCode: 'YER', amount: '200', customerCode: '20011', customerName: 'عميل آجل', customerMobile: null,
          customerAddress: null, customerBindingStatus: 'linked_by_code', approved: false, processed: false,
          updatedAt: null, lines: [{ lineNo: 1, itemCode: 'I2', itemName: 'صنف', unitCode: 'حبة', quantity: '2', packageSize: '1', unitPrice: '100', warehouseCode: '101', cancelled: false }],
        },
      ],
    }) } as any;
    const service = new SalesOrderDraftsService(prisma, audit, reader);
    const result = await service.syncOracle(actor, {} as any);
    expect(result).toEqual(expect.objectContaining({ mode: 'SELECT_ONLY', oracleWrite: 'NONE', total: 2, created: 2 }));
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0][0].create).toEqual(expect.objectContaining({
      sourceSchema: 'IAS20261', orderKind: 'cash', customerBindingStatus: 'cash_name_only', oracleWriteEnabled: false,
    }));
    expect(upsert.mock.calls[1][0].create).toEqual(expect.objectContaining({
      orderKind: 'credit', proposedCustomerCode: '20011', proposedCustomerName: 'عميل آجل', oracleWriteEnabled: false,
    }));
  });

  it('does not move a blocked imported order to ready for approval', async () => {
    const prisma = {
      salesOrderDraft: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'draft-1', organizationId: actor.organizationId, validationStatus: 'blocked', status: 'draft_review', lines: [],
        }),
        update: jest.fn(),
      },
    } as any;
    const service = new SalesOrderDraftsService(prisma, audit);
    await expect(service.process(actor, 'draft-1', { status: 'ready_for_approval' }, {} as any))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.salesOrderDraft.update).not.toHaveBeenCalled();
  });
});
