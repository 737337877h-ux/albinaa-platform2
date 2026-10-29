export interface BalanceValue { currency?: string; currencyCode?: string; balance?: number; accountingBalance?: number }

const FOLLOWUP_LIMITS: Record<string, number> = {
  YER: 3_000, YR: 3_000, SAR: 30, SR: 30, USD: 5,
};

export function isActionableBalance(item: BalanceValue): boolean {
  const amount = Number(item.balance ?? item.accountingBalance ?? 0);
  const currency = String(item.currency ?? item.currencyCode ?? '').trim().toUpperCase();
  return Number.isFinite(amount) && amount > (FOLLOWUP_LIMITS[currency] ?? 0) + 0.00005;
}

export function parseBalances(value: unknown): BalanceValue[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function totalAbsoluteBalance(value: unknown): number {
  return parseBalances(value).reduce((sum, item) => sum + Math.abs(Number(item.balance ?? item.accountingBalance ?? 0)), 0);
}

/** Total debtor exposure only. Credit and settled balances never contribute. */
export function totalDebtorBalance(value: unknown): number {
  return parseBalances(value).reduce((sum, item) => {
    const amount = Number(item.balance ?? item.accountingBalance ?? 0);
    return amount > 0.001 ? sum + amount : sum;
  }, 0);
}

export function totalActionableDebtorBalance(value: unknown): number {
  return parseBalances(value).reduce((sum, item) =>
    isActionableBalance(item) ? sum + Number(item.balance ?? item.accountingBalance ?? 0) : sum, 0);
}

export function largestDebtorBalance(value: unknown): BalanceValue | null {
  return parseBalances(value)
    .filter((item) => Number(item.balance ?? item.accountingBalance ?? 0) > 0.001)
    .sort((a, b) => Number(b.balance ?? b.accountingBalance ?? 0) - Number(a.balance ?? a.accountingBalance ?? 0))[0] ?? null;
}

export function largestActionableDebtorBalance(value: unknown): BalanceValue | null {
  return parseBalances(value)
    .filter(isActionableBalance)
    .sort((a, b) => Number(b.balance ?? b.accountingBalance ?? 0) - Number(a.balance ?? a.accountingBalance ?? 0))[0] ?? null;
}

export function totalsByCurrency(accounts: any[], debtOnly = false): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const account of accounts) {
    for (const balance of parseBalances(account.balances)) {
      const amount = Number(balance.balance ?? balance.accountingBalance ?? 0);
      if (debtOnly && amount <= 0) continue;
      const currency = balance.currency || balance.currencyCode || '—';
      totals[currency] = (totals[currency] || 0) + amount;
    }
  }
  return totals;
}

export function formatBalance(value: number): string {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function searchableCustomerText(customer: any): string {
  return [customer.fullName, customer.accountNumber, customer.externalCustomerCode,
    customer.phonePrimary, customer.phoneSecondary, customer.whatsapp]
    .filter(Boolean).join(' ').toLocaleLowerCase('ar');
}
