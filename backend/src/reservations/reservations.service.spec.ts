import { ReservationsService, reservationAverageTonPrice, reservationWeightTons } from './reservations.service';

describe('reservation outstanding display', () => {
  it('keeps original cancelled quantities but exposes no outstanding goods', async () => {
    const row = { status: 'cancelled', quantity: 2, remainingQty: 2, totalAmount: 770000, remainingTons: 2 };
    const service = new ReservationsService({ reservation: { findMany: jest.fn().mockResolvedValue([row]) } } as any, {} as any);
    const [result] = await service.findAll({ organizationId: 'org' } as any);
    expect(Number(result.remainingQty)).toBe(0);
    expect(Number(result.remainingTons)).toBe(0);
    expect(result.quantity).toBe(2);
    expect(result.totalAmount).toBe(770000);
    expect(row.remainingQty).toBe(2);
  });
});

describe('reservation weight conversion', () => {
  it('converts normalized units to tons', () => {
    expect(reservationWeightTons(2, 1000)).toBe(2);
    expect(reservationWeightTons(20, 50)).toBe(1);
    expect(reservationWeightTons(40, 25)).toBe(1);
  });

  it('keeps units without a weight outside the ton total', () => {
    expect(reservationWeightTons(3200, null)).toBeNull();
  });
});

describe('reservation average ton price', () => {
  it('calculates the weighted ton price for one currency', () => {
    expect(reservationAverageTonPrice(1_250_000, 50)).toBe(25_000);
  });

  it('does not invent a price when no weighted tons exist', () => {
    expect(reservationAverageTonPrice(100_000, 0)).toBeNull();
  });
});

describe('reservation customer options', () => {
  it('searches ordinary customer accounts without applying debt-balance thresholds', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'customer-20011', name: 'عامر العامري', externalCustomerCode: '20011', accountNumber: '20011' },
    ]);
    const service = new ReservationsService(
      { customer: { findMany } } as never,
      {} as never,
    );

    const result = await service.searchCustomerOptions({ organizationId: 'org-1' } as never, '20011');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].externalCustomerCode).toBe('20011');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: 'org-1',
        OR: [{ customerType: null }, { customerType: { not: 'advance' } }],
      }),
    }));
    expect(JSON.stringify(findMany.mock.calls[0][0].where)).not.toContain('balances');
  });
});
