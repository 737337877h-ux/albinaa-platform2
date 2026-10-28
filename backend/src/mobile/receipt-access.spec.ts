import { MobileService } from './mobile.service';

describe('Oracle receipt ownership', () => {
  it('binds a new upload to the authenticated creation audit', async () => {
    const audit = { id: 'creation-id', entityId: 'serial11', createdAt: new Date(),
      newValue: { kind: 'voucher', requestKind: 'receipt', requestNo: '11', externalReference: 'unique-ref' } };
    const prisma = { auditLog: { findMany: jest.fn().mockResolvedValue([audit]) },
      attachment: { create: jest.fn().mockResolvedValue({ id: 'image-id' }) } };
    await new MobileService(prisma as any).uploadOracleRequestReceipt({ id: 'owner', organizationId: 'org',
      permissions: ['oracle_test_requests.receipt.create'] } as any,
      { path: '/unused-test-path', originalname: 'receipt.jpg' } as any,
      { kind: 'receipt', requestNo: '11', externalReference: 'unique-ref' });
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.userId).toBe('owner');
    expect(prisma.attachment.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      entityTable: 'oracle_request:receipt:audit', entityId: 'creation-id', uploadedBy: 'owner',
    }) });
  });
  it('denies another collector image even with generic receipt view permission', async () => {
    const prisma = { attachment: { findUnique: jest.fn().mockResolvedValue({
      entityTable: 'oracle_request:receipt:audit', uploadedBy: 'other',
    }) }, user: { findFirst: jest.fn().mockResolvedValue({ id: 'other' }) } };
    await expect(new MobileService(prisma as any).downloadReceipt({ id: 'me', organizationId: 'org',
      permissions: ['mobile.receipts.view', 'oracle_test_requests.receipt.read'] } as any, 'image'))
      .rejects.toThrow('لا تملك صلاحية عرض إيصال محصل آخر');
  });
  it('denies cross-organization images even for a reviewer', async () => {
    const prisma = { attachment: { findUnique: jest.fn().mockResolvedValue({
      entityTable: 'oracle_request:receipt:audit', uploadedBy: 'other',
    }) }, user: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(new MobileService(prisma as any).downloadReceipt({ id: 'admin', organizationId: 'org',
      permissions: ['settings.manage'] } as any, 'image')).rejects.toThrow('خارج نطاق صلاحيتك');
  });
});
