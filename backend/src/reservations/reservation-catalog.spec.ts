import { RESERVATION_ITEM_STANDARDS, rodsToTons } from './reservation-catalog';

describe('reservation item standards', () => {
  it('keeps the ten approved rebar items without duplicates', () => {
    expect(RESERVATION_ITEM_STANDARDS).toHaveLength(10);
    expect(new Set(RESERVATION_ITEM_STANDARDS.map((item) => item.itemCode)).size).toBe(10);
  });

  it.each([
    ['230800105001', 150, 0.75],
    ['230800105005', 50, 1],
    ['230800405007', 45, 0.5],
  ])('converts rods for %s to tons', (itemCode, rods, expected) => {
    expect(rodsToTons(itemCode, rods)).toBe(expected);
  });

  it('does not infer a conversion for unapproved items', () => {
    expect(rodsToTons('unknown', 100)).toBeNull();
  });
});
