import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { MobileService } from './mobile.service';

describe('mobile offline GPS references', () => {
  const id = '52c06c1a-b5c0-416e-995d-578897854832';
  const user = { id: 'user-1', organizationId: 'org-1' } as any;
  const point = { latitude: 15.3, longitude: 44.2, entityTable: 'payment_promises', entityId: 'local:pending-1' };
  let db: any;
  let service: MobileService;
  beforeEach(() => {
    db = {
      idempotencyKey: { findUnique: jest.fn().mockResolvedValue({ response: { id } }) },
      paymentPromise: { findFirst: jest.fn().mockResolvedValue({ id }) },
      collection: { findFirst: jest.fn().mockResolvedValue({ id }) },
      gpsLog: { createMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn() },
    };
    service = new MobileService(db);
  });
  it('resolves an offline promise and preserves the original capture time', async () => {
    await service.saveGpsBatch(user, [{ ...point, recordedAt: '2026-09-02T10:00:00Z' }]);
    expect(db.idempotencyKey.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'POST:/payment-promises:pending-1' } }));
    expect(db.paymentPromise.findFirst).toHaveBeenCalledWith({ where: { id, customer: { organizationId: 'org-1' }, collector: { userId: 'user-1' } }, select: { id: true } });
    expect(db.gpsLog.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ entityId: id, timestamp: new Date('2026-09-02T10:00:00Z') })] });
  });
  it('also resolves collection references on the single-point endpoint', async () => {
    await service.saveGps(user, { ...point, entityTable: 'collections' });
    expect(db.collection.findFirst).toHaveBeenCalled();
    expect(db.gpsLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entityId: id }) });
  });
  it('keeps the entire batch retryable until the business operation is synced', async () => {
    db.idempotencyKey.findUnique.mockResolvedValue(null);
    await expect(service.saveGpsBatch(user, [{ ...point, entityId: id }, point])).rejects.toBeInstanceOf(ConflictException);
    expect(db.gpsLog.createMany).not.toHaveBeenCalled();
  });
  it('does not link another user or organization operation', async () => {
    db.paymentPromise.findFirst.mockResolvedValue(null);
    await expect(service.saveGpsBatch(user, [point])).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.gpsLog.createMany).not.toHaveBeenCalled();
  });
  it('rejects malformed IDs before Prisma instead of failing with HTTP 500', async () => {
    await expect(service.saveGpsBatch(user, [{ ...point, entityId: 'broken' }])).rejects.toBeInstanceOf(BadRequestException);
    expect(db.gpsLog.createMany).not.toHaveBeenCalled();
  });
  it('accepts a normal UUID or an unlinked location', async () => {
    await service.saveGpsBatch(user, [{ ...point, entityId: id }, { latitude: 15, longitude: 44 }]);
    expect(db.gpsLog.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ entityId: id }), expect.objectContaining({ entityId: null })] });
  });
  it('validates coordinates and does not write an empty batch', async () => {
    await expect(service.saveGpsBatch(user, [{ ...point, latitude: 100 }])).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveGpsBatch(user, [])).resolves.toEqual({ count: 0 });
    expect(db.gpsLog.createMany).not.toHaveBeenCalled();
  });
});
