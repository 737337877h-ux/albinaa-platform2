const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;

export function normalizeSmartSearch(value: unknown): string {
  return String(value ?? '')
    .toLocaleLowerCase('ar')
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/[^\p{L}\p{N}/]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function smartSearchTerms(value: unknown): string[] {
  return [...new Set(normalizeSmartSearch(value).split(' ').filter(Boolean))];
}

export function matchesSmartSearch(haystack: unknown, query: unknown): boolean {
  const text = normalizeSmartSearch(haystack);
  return smartSearchTerms(query).every((term) => text.includes(term));
}
