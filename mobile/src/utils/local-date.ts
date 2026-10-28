export function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

/** Accepts both local SQLite timestamps and zoned server timestamps. */
export function isLocalToday(value: unknown, today: string): boolean {
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (!hasExplicitZone && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10) === today;
  const parsed = new Date(raw);
  return !Number.isNaN(parsed.getTime()) && localDateKey(parsed) === today;
}
