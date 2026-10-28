export interface SystemVoucherCurrency { code: string; rate?: number | string; local?: boolean; fractionDigits?: number; rateUpdatedAt?: string | null }
export function normalizeVoucherAmount(value: string) {
  return value.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/[٬,\s]/g, '').replace(/٫/g, '.');
}
/** EX_RATE rates are local currency per unit. Match the server's rounding. */
export function voucherCounterAmount(value: string, source?: SystemVoucherCurrency, target?: SystemVoucherCurrency) {
  const amount = Number(normalizeVoucherAmount(value));
  if (!source?.code || !target?.code || !Number.isFinite(amount) || amount <= 0) return null;
  if (source.code === target.code) return { amount: normalizeVoucherAmount(value), rate: 1, roundingDifference: 0 };
  const fromRate = source.local ? 1 : Number(source.rate);
  const toRate = target.local ? 1 : Number(target.rate);
  const fromDigits = Number(source.fractionDigits ?? 2), toDigits = Number(target.fractionDigits ?? 2);
  if (![fromRate,toRate].every(n => Number.isFinite(n) && n > 0)
    || ![fromDigits,toDigits].every(n => Number.isInteger(n) && n >= 0 && n <= 6)) return null;
  const round = (n: number, digits: number) => Math.round((n + Number.EPSILON) * 10 ** digits) / 10 ** digits;
  const local = source.local ? amount : round(amount * fromRate, fromDigits);
  const converted = round(local / toRate, toDigits);
  if (!Number.isFinite(converted) || converted <= 0) return null;
  const back = target.local ? converted : round(converted * toRate, toDigits);
  return { amount: String(converted), rate: fromRate / toRate, roundingDifference: round(local - back, 2) };
}
