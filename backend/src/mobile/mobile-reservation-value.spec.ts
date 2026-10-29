import { mobileReservationValue } from './mobile-reservation-value';
describe('mobile outstanding reservation value', () => {
  it.each(['cancelled', 'completed', 'fulfilled'])('does not expose historical quantity as outstanding for %s', (status) => {
    const input = { status, quantity: 2, remainingQty: 2, totalTons: 2, remainingTons: 2, totalAmount: 770000, unitPrice: 385000 };
    expect(mobileReservationValue(input)).toEqual({ quantity: 2, remainingQty: 0, totalTons: 0, totalAmount: 0, averageTonPrice: null });
    expect(input.remainingQty).toBe(2);
  });
  const original = { quantity: '2.646', totalTons: '2.646', unitPrice: '2770', totalAmount: '7329.42' };
  it('deducts invoice 3460 without overwriting the original amount', () => {
    const input = { ...original, remainingQty: '2.586', remainingTons: '2.586' };
    expect(mobileReservationValue(input)).toEqual(expect.objectContaining({ totalAmount: 7163.22, totalTons: 2.586 }));
    expect(mobileReservationValue(input).averageTonPrice).toBeCloseTo(2770);
    expect(input.totalAmount).toBe('7329.42');
  });
  it('preserves zero after full issue', () => {
    expect(mobileReservationValue({ ...original, remainingQty: 0, remainingTons: 0 }).totalAmount).toBe(0);
  });
  it('preserves the value before issue', () => {
    expect(mobileReservationValue({ ...original, remainingQty: '2.646', remainingTons: '2.646' }).totalAmount).toBe(7329.42);
  });
  it('supports legacy units and a missing price', () => {
    expect(mobileReservationValue({ quantity: 20, remainingQty: 10, totalAmount: 200,
      measureUnit: { weightKg: 50 } })).toEqual(expect.objectContaining({ totalAmount: 100, totalTons: 0.5 }));
  });
});
