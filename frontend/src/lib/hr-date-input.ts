const ARABIC_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

export function westernDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => ARABIC_DIGITS[digit] || digit);
}

function validDate(year: number, month: number, day: number): boolean {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseFlexibleDate(
  input: string,
  now = new Date(),
): { year: number; month: number; day: number; iso: string; display: string } | null {
  const normalized = westernDigits(String(input || '').trim());
  let year: number;
  let month: number;
  let day: number;

  const isoMatch = normalized.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const displayMatch = normalized.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/);
  if (isoMatch) {
    year = Number(isoMatch[1]); month = Number(isoMatch[2]); day = Number(isoMatch[3]);
  } else if (displayMatch) {
    day = Number(displayMatch[1]); month = Number(displayMatch[2]);
    year = displayMatch[3]
      ? (displayMatch[3].length === 2 ? 2000 + Number(displayMatch[3]) : Number(displayMatch[3]))
      : now.getFullYear();
  } else {
    const digits = normalized.replace(/\D/g, '');
    if (digits.length === 3) {
      day = Number(digits.slice(0, 2)); month = Number(digits.slice(2)); year = now.getFullYear();
    } else if (digits.length === 4) {
      day = Number(digits.slice(0, 2)); month = Number(digits.slice(2, 4)); year = now.getFullYear();
    } else if (digits.length === 6) {
      day = Number(digits.slice(0, 2)); month = Number(digits.slice(2, 4)); year = 2000 + Number(digits.slice(4));
    } else if (digits.length === 7) {
      day = Number(digits.slice(0, 2)); month = Number(digits.slice(2, 3)); year = Number(digits.slice(3));
    } else if (digits.length === 8) {
      day = Number(digits.slice(0, 2)); month = Number(digits.slice(2, 4)); year = Number(digits.slice(4));
    } else return null;
  }

  if (!validDate(year, month, day)) return null;
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return { year, month, day, iso: `${year}-${mm}-${dd}`, display: `${dd}-${mm}-${year}` };
}
