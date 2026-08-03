import { reservationWeightTons } from './reservations.service';

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
