/**
 * Minimum debtor balances that justify operational follow-up.
 * Oracle remains the balance source; this policy only controls work queues.
 */
export const FOLLOWUP_MINIMUM_BY_CURRENCY: Readonly<Record<string, number>> = {
  YER: 3_000,
  YR: 3_000,
  SAR: 30,
  SR: 30,
  USD: 5,
};

export function normalizedCurrencyCode(currency: string | null | undefined): string {
  return String(currency ?? '').trim().toUpperCase();
}

/** Zero, credit, and balances at or below the currency limit are not actionable. */
export function isActionableDebtorBalance(
  amount: number,
  currency: string | null | undefined,
): boolean {
  if (!Number.isFinite(amount)) return false;
  const threshold = FOLLOWUP_MINIMUM_BY_CURRENCY[normalizedCurrencyCode(currency)] ?? 0;
  return amount > threshold + 0.00005;
}

/** Significant account balances for reporting, regardless of debit/credit side. */
export function isSignificantBalance(
  amount: number,
  currency: string | null | undefined,
): boolean {
  if (!Number.isFinite(amount)) return false;
  const threshold = FOLLOWUP_MINIMUM_BY_CURRENCY[normalizedCurrencyCode(currency)] ?? 0;
  return Math.abs(amount) > threshold + 0.00005;
}
