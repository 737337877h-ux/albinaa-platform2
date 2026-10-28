/** Same day-first compact entry contract as the phone's date-input utility. */
export function smartStatementDate(input: string, now = new Date()): string | null {
  const raw = input.trim().replace(/[٠-٩۰-۹]/g, c => String(c.charCodeAt(0) - (c <= '٩' ? 0x660 : 0x6f0)));
  let d: number, m: number, y: number;
  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const parts = raw.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else if (parts) { d = +parts[1]; m = +parts[2]; y = parts[3] ? +parts[3] + (parts[3].length === 2 ? 2000 : 0) : now.getFullYear(); }
  else if (/^\d{3,8}$/.test(raw) && [3,4,6,7,8].includes(raw.length)) {
    d = +raw.slice(0,2); m = +raw.slice(2, raw.length === 3 || raw.length === 7 ? 3 : 4);
    y = raw.length < 5 ? now.getFullYear() : raw.length === 6 ? 2000 + +raw.slice(4) : +raw.slice(raw.length === 7 ? 3 : 4);
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 2000 || y > 2100 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
