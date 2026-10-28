export interface BalanceValue {
  currency?: string;
  currencyCode?: string;
  balance?: number;
  accountingBalance?: number;
  operationalBalance?: number;
}
export type BalanceSide = 'debtor' | 'creditor';

export function customerEngagementIds(...groups: any[][]): Set<string> {
  return new Set(groups.flat().map((item) => String(item?.customerId ?? '')).filter(Boolean));
}

export function hasCustomerEngagement(account: any, localEngagementIds: Set<string>): boolean {
  return !!account?.hasRecordedEngagement || localEngagementIds.has(String(account?.id ?? ''));
}

/** Unknown legacy snapshots must sync before claiming there has never been a follow-up. */
export function hasNoRecordedFollowup(account: any, localFollowupIds: Set<string>): boolean {
  return (account?.hasRecordedFollowup === false || account?.hasRecordedFollowup === 0)
    && !localFollowupIds.has(String(account?.id ?? ''));
}

const FOLLOWUP_LIMITS: Record<string, number> = {
  YER: 3_000, YR: 3_000, SAR: 30, SR: 30, USD: 5,
};

/** The operational value includes local collections created after the last Oracle import. */
export function balanceAmount(item: BalanceValue): number {
  return Number(item.operationalBalance ?? item.balance ?? item.accountingBalance ?? 0);
}

export function isActionableBalance(item: BalanceValue): boolean {
  const amount = balanceAmount(item);
  const currency = String(item.currency ?? item.currencyCode ?? '').trim().toUpperCase();
  return Number.isFinite(amount) && amount > (FOLLOWUP_LIMITS[currency] ?? 0) + 0.00005;
}

/** Significant balance on either side, used by advance-account reporting. */
export function isSignificantBalance(item: BalanceValue): boolean {
  const amount = balanceAmount(item);
  const currency = String(item.currency ?? item.currencyCode ?? '').trim().toUpperCase();
  return Number.isFinite(amount) && Math.abs(amount) > (FOLLOWUP_LIMITS[currency] ?? 0) + 0.00005;
}

export function canonicalCurrencyCode(value: unknown): string {
  const code = String(value ?? '').trim().toUpperCase();
  if (code === 'YR') return 'YER';
  if (code === 'SR') return 'SAR';
  if (code === '$') return 'USD';
  return code;
}

export function isBalanceForCurrencySide(item: BalanceValue, currency: unknown, side: BalanceSide): boolean {
  if (!isSignificantBalance(item)) return false;
  if (canonicalCurrencyCode(item.currency ?? item.currencyCode) !== canonicalCurrencyCode(currency)) return false;
  const amount = balanceAmount(item);
  return side === 'debtor' ? amount > 0 : amount < 0;
}

export function totalBalanceForCurrencySide(value: unknown, currency: unknown, side: BalanceSide): number {
  return parseBalances(value).reduce((sum, item) => isBalanceForCurrencySide(item, currency, side)
    ? sum + Math.abs(balanceAmount(item))
    : sum, 0);
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
  return parseBalances(value).reduce((sum, item) => sum + Math.abs(balanceAmount(item)), 0);
}

/** Total debtor exposure only. Credit and settled balances never contribute. */
export function totalDebtorBalance(value: unknown): number {
  return parseBalances(value).reduce((sum, item) => {
    const amount = balanceAmount(item);
    return amount > 0.001 ? sum + amount : sum;
  }, 0);
}

export function totalActionableDebtorBalance(value: unknown): number {
  return parseBalances(value).reduce((sum, item) =>
    isActionableBalance(item) ? sum + balanceAmount(item) : sum, 0);
}

export function totalSignificantBalance(value: unknown): number {
  return parseBalances(value).reduce((sum, item) =>
    isSignificantBalance(item) ? sum + Math.abs(balanceAmount(item)) : sum, 0);
}

export function largestDebtorBalance(value: unknown): BalanceValue | null {
  return parseBalances(value)
    .filter((item) => balanceAmount(item) > 0.001)
    .sort((a, b) => balanceAmount(b) - balanceAmount(a))[0] ?? null;
}

export function largestActionableDebtorBalance(value: unknown): BalanceValue | null {
  return parseBalances(value)
    .filter(isActionableBalance)
    .sort((a, b) => balanceAmount(b) - balanceAmount(a))[0] ?? null;
}

export function totalsByCurrency(accounts: any[], debtOnly = false): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const account of accounts) {
    for (const balance of parseBalances(account.balances)) {
      const amount = balanceAmount(balance);
      if (debtOnly && amount <= 0) continue;
      const currency = canonicalCurrencyCode(balance.currency || balance.currencyCode || '—');
      totals[currency] = (totals[currency] || 0) + amount;
    }
  }
  return totals;
}

export function totalsByCurrencySide(accounts: any[], side: BalanceSide): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const account of accounts) {
    for (const balance of parseBalances(account.balances)) {
      if (!isSignificantBalance(balance)) continue;
      const amount = balanceAmount(balance);
      if ((side === 'debtor' && amount <= 0) || (side === 'creditor' && amount >= 0)) continue;
      const currency = canonicalCurrencyCode(balance.currency || balance.currencyCode || '—');
      totals[currency] = (totals[currency] || 0) + Math.abs(amount);
    }
  }
  return totals;
}

/** Gross dashboard totals: keep small positive/negative amounts, unlike work-list filters. */
export function grossTotalsByCurrencySide(accounts: any[], side: BalanceSide): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const account of accounts) {
    for (const balance of parseBalances(account.balances)) {
      const amount = balanceAmount(balance);
      if (!Number.isFinite(amount) || (side === 'debtor' ? amount <= 0.005 : amount >= -0.005)) continue;
      const currency = canonicalCurrencyCode(balance.currency || balance.currencyCode || '—');
      totals[currency] = (totals[currency] || 0) + Math.abs(amount);
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
