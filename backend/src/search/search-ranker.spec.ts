import { searchRank } from './search-ranker';

describe('searchRank', () => {
  it('places exact matches before prefixes and contains matches', () => {
    expect(searchRank('R-2026-000001', 'R-2026-000001')).toBeLessThan(searchRank('R-2026-000001-extra', 'R-2026-000001'));
    expect(searchRank('عميل البناء الراقي', 'عميل')).toBeLessThan(searchRank('شركة عميل البناء', 'عميل'));
  });

  it('is case insensitive', () => expect(searchRank('INV-500', 'inv-500')).toBe(0));
});
