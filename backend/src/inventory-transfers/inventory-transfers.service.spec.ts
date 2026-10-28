import { BadRequestException, ConflictException } from '@nestjs/common';
import { InventoryTransfersService } from './inventory-transfers.service';

describe('InventoryTransfersService Oracle document linking', () => {
  const actor = {
    id: 'user-1', organizationId: 'org-1', branchId: null,
    username: 'reviewer', fullName: 'Reviewer', permissions: [], roles: [],
  };
  const request = {} as any;
  const approved = {
    id: 'transfer-1', organizationId: 'org-1', status: 'approved',
    sourceWarehouseCode: '102', destinationWarehouseCode: '101',
    oracleSourceTransferSerial: null,
    lines: [{ itemCode: 'ITEM-1' }],
  };

  function setup(row: any = approved) {
    const prisma = {
      inventoryTransferRequest: {
        findFirst: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockImplementation(async ({ data }) => ({ ...row, ...data })),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const oracle = {
      directLookupsEnabled: jest.fn().mockReturnValue(false),
      warehouseExists: jest.fn(), stock: jest.fn(), transferDocumentsByOutRequest: jest.fn(), transferStatus: jest.fn(),
    };
    const writer = {
      isEnabled: jest.fn().mockReturnValue(false),
      allowsInsufficientStock: jest.fn().mockReturnValue(false),
      targetSchema: jest.fn().mockReturnValue(null),
      createDraft: jest.fn(),
    };
    const service = new InventoryTransfersService(prisma as any, audit as any, oracle as any, {} as any, writer as any);
    return { service, prisma, audit, oracle, writer };
  }

  it('verifies through the read-only reader before storing the linked serial and status', async () => {
    const { service, prisma, audit, oracle } = setup();
    oracle.transferStatus.mockResolvedValue({
      outReqSer: null,
      transferDocumentNumber: '9',
      sourceTransferSerial: '20260000011119',
      destinationTransferSerial: null,
      sourceIssued: true,
      destinationReceived: false,
      transferCompleted: false,
    });

    await expect(service.linkOracleDocument(actor, 'transfer-1', {
      sourceTransferSerial: '20260000011119',
    }, request)).resolves.toMatchObject({ found: true });
    expect(oracle.transferStatus).toHaveBeenCalledWith({
      sourceTransferSerial: '20260000011119',
      sourceWarehouseCode: '102',
      destinationWarehouseCode: '101',
      itemCodes: ['ITEM-1'],
    });
    expect(prisma.inventoryTransferRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        oracleSourceTransferSerial: '20260000011119',
        sourceIssued: true,
        destinationReceived: false,
        transferCompleted: false,
      }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'inventory_transfer_oracle_document_linked',
      newValue: expect.objectContaining({ oracleWriteAttempted: false }),
    }));
  });

  it('rejects linking before approval without querying Oracle', async () => {
    const { service, oracle } = setup({ ...approved, status: 'draft' });
    await expect(service.linkOracleDocument(actor, 'transfer-1', {
      sourceTransferSerial: '20260000011119',
    }, request)).rejects.toBeInstanceOf(ConflictException);
    expect(oracle.transferStatus).not.toHaveBeenCalled();
  });

  it('does not store a serial when Oracle has no matching transfer evidence', async () => {
    const { service, prisma, oracle } = setup();
    oracle.transferStatus.mockResolvedValue(null);
    await expect(service.linkOracleDocument(actor, 'transfer-1', {
      sourceTransferSerial: '20260000011119',
    }, request)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.inventoryTransferRequest.update).not.toHaveBeenCalled();
  });

  it('downgrades a previously completed platform status when Oracle evidence was cancelled', async () => {
    const linked = {
      ...approved,
      oracleSourceTransferSerial: '202600000111131',
      oracleDestinationTransferSerial: '202600000111230',
      oracleTransferDocumentNumber: '31',
      sourceIssued: true,
      destinationReceived: true,
      transferCompleted: true,
    };
    const { service, prisma, audit, oracle } = setup(linked);
    oracle.transferStatus.mockResolvedValue(null);

    await expect(service.refreshOracleStatus(actor, 'transfer-1', request)).resolves.toMatchObject({
      found: false,
      request: expect.objectContaining({
        sourceIssued: false,
        destinationReceived: false,
        transferCompleted: false,
      }),
    });
    expect(prisma.inventoryTransferRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        oracleTransferDocumentNumber: null,
        oracleDestinationTransferSerial: null,
        sourceIssued: false,
        destinationReceived: false,
        transferCompleted: false,
      }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'inventory_transfer_oracle_status_missing',
      newValue: expect.objectContaining({ oracleWriteAttempted: false }),
    }));
  });

  it('discovers the source TR_SER automatically from OUT_REQ_SER before reading movement status', async () => {
    const unlinked = { ...approved, oracleOutReqSer: '20260000015' };
    const { service, prisma, audit, oracle } = setup(unlinked);
    oracle.transferDocumentsByOutRequest.mockResolvedValue([{
      transferSerial: '202600000111131', transferDocumentNumber: '31',
      warehouseCode: '102', destinationWarehouseCode: '101',
    }]);
    oracle.transferStatus.mockResolvedValue({
      outReqSer: null,
      transferDocumentNumber: '31',
      sourceTransferSerial: '202600000111131',
      destinationTransferSerial: null,
      sourceIssued: true,
      destinationReceived: false,
      transferCompleted: false,
    });

    await expect(service.refreshOracleStatus(actor, 'transfer-1', request)).resolves.toMatchObject({
      found: true,
      request: expect.objectContaining({ oracleSourceTransferSerial: '202600000111131', sourceIssued: true }),
    });
    expect(oracle.transferDocumentsByOutRequest).toHaveBeenCalledWith('20260000015');
    expect(oracle.transferStatus).toHaveBeenCalledWith(expect.objectContaining({
      sourceTransferSerial: '202600000111131',
      sourceWarehouseCode: '102',
      destinationWarehouseCode: '101',
    }));
    expect(prisma.inventoryTransferRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        oracleOutReqSer: '20260000015',
        oracleSourceTransferSerial: '202600000111131',
      }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'inventory_transfer_oracle_status_read' }));
  });

  it('creates one idempotent IAS20191 draft during approval when the isolated writer is enabled', async () => {
    const pending = {
      ...approved,
      status: 'pending_approval',
      createdBy: 'creator-1',
      notes: 'اختبار',
      lines: [{ lineNo: 1, itemCode: '00101-01-01', unitCode: 'حبة', quantity: 1 }],
    };
    const { service, prisma, audit, writer } = setup(pending);
    jest.spyOn(service, 'dryRun').mockResolvedValue({ valid: true, issues: [] } as any);
    writer.isEnabled.mockReturnValue(true);
    writer.targetSchema.mockReturnValue('IAS20191');
    writer.createDraft.mockResolvedValue({ created: true, requestNo: '3', requestSerial: '20190000013' });

    await service.approve(actor, 'transfer-1', { note: 'موافق' }, request);

    expect(writer.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      externalReference: 'inventory-transfer:transfer-1',
      sourceWarehouseCode: '102',
      destinationWarehouseCode: '101',
      lines: [{ itemCode: '00101-01-01', unitCode: 'حبة', quantity: 1 }],
    }));
    expect(prisma.inventoryTransferRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'approved', oracleOutReqNo: '3', oracleOutReqSer: '20190000013',
      }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'inventory_transfer_approved_oracle_draft_created',
      newValue: expect.objectContaining({ oracleWriteAttempted: true, oracleWriteSchema: 'IAS20191' }),
    }));
  });

  it('keeps zero stock as a warning in isolated IAS20191 draft mode', async () => {
    const pending = {
      ...approved,
      status: 'pending_approval', createdBy: 'creator-1',
      lines: [{ lineNo: 1, itemCode: '00103-01-04', unitCode: 'حبة', quantity: 1 }],
    };
    const { service, oracle, writer } = setup(pending);
    oracle.directLookupsEnabled.mockReturnValue(true);
    oracle.warehouseExists.mockResolvedValue(true);
    oracle.stock.mockResolvedValue({
      warehouseExists: true, itemExists: true, unitExists: true, packageSize: 1, availableQuantity: 0,
    });
    writer.isEnabled.mockReturnValue(true);
    writer.allowsInsufficientStock.mockReturnValue(true);

    await expect(service.dryRun(actor, 'transfer-1')).resolves.toMatchObject({
      valid: true,
      allowInsufficientStock: true,
      issues: [expect.objectContaining({ code: 'INSUFFICIENT_SOURCE_STOCK', severity: 'warning' })],
    });
  });
});
