import { normalizeSmartSearch, smartSearchTerms } from './smart-search';

describe('smart search', () => {
  it('normalizes Arabic variants and punctuation', () => {
    expect(normalizeSmartSearch('  كُوع زاوية 3/4" ـ فابكو  ')).toBe('كوع زاويه 3 4 فابكو');
  });

  it('builds distinct AND terms for field search', () => {
    expect(smartSearchTerms('كوع 3 فابكو كوع')).toEqual(['كوع', '3', 'فابكو']);
    expect(smartSearchTerms('كوع زاويه راك ثيرم')).toEqual(['كوع', 'زاويه', 'راك', 'ثيرم']);
  });
});
