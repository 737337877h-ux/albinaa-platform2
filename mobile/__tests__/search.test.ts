import { describe, expect, it } from '@jest/globals';
import { matchesSmartSearch, normalizeSmartSearch, smartSearchTerms } from '../src/utils/search';

describe('smart Arabic search', () => {
  it('matches item words regardless of their order', () => {
    expect(matchesSmartSearch('كوع زاوية 3 بوصة 90 ملي فابكو', 'كوع 3 فابكو')).toBe(true);
    expect(matchesSmartSearch('كوع زاويه 3/4 لحام طويل اسود راك ثيرم', 'كوع زاوية راك ثيرم')).toBe(true);
  });

  it('normalizes Arabic letter variants and removes diacritics', () => {
    expect(normalizeSmartSearch('إبراهيم ـ الرَّاقي')).toBe('ابراهيم الراقي');
  });

  it('deduplicates search terms', () => {
    expect(smartSearchTerms('كوع كوع 3')).toEqual(['كوع', '3']);
  });
});
