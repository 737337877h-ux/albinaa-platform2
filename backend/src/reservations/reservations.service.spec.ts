import { reservationAverageTonPrice, reservationWeightTons } from './reservations.service';

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
