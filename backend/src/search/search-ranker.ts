export function searchRank(value: string | null | undefined, rawQuery: string): number {
  const candidate = (value ?? '').trim().toLocaleLowerCase('ar');
  const query = rawQuery.trim().toLocaleLowerCase('ar');
  if (!candidate || !query) return 99;
  if (candidate === query) return 0;
  if (candidate.startsWith(query)) return 1;
  if (candidate.includes(query)) return 2;
  return 99;
}
