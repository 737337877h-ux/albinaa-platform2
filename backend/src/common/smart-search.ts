const ARABIC_DIACRITICS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;

/**
 * Normalizes Arabic names and splits a field query into independent terms.
 * Every returned term must match, while the words may appear in any order and
 * may be separated by model, size, brand or other item/customer attributes.
 */
export function normalizeSmartSearch(value: string): string {
  return value
    .normalize('NFKC')
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[إأآٱا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function smartSearchTerms(value?: string | null, maxTerms = 8): string[] {
  if (!value?.trim()) return [];
  return [...new Set(normalizeSmartSearch(value).split(' ').filter(Boolean))].slice(0, maxTerms);
}
