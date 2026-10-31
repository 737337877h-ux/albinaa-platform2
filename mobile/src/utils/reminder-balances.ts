type BalanceRow = {
  balance?: unknown; operationalBalance?: unknown; accountingBalance?: unknown;
  currency?: string | { code?: string }; currencyCode?: string;
};

const names: Record<string, string> = { YER: 'ريال يمني', SAR: 'ريال سعودي', USD: 'دولار أمريكي' };
export function reminderBalanceText(rows: BalanceRow[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const raw = typeof row.currency === 'string' ? row.currency : row.currency?.code || row.currencyCode || '';
    const currency = ({ YR: 'YER', SR: 'SAR' } as Record<string, string>)[raw.toUpperCase()] || raw.toUpperCase();
    const amount = Number(row.balance ?? row.operationalBalance ?? row.accountingBalance ?? 0);
    if (!currency || !Number.isFinite(amount)) continue;
    totals.set(currency, (totals.get(currency) || 0) + amount);
  }
  const debts = [...totals].filter(([, amount]) => amount > 0.001);
  const amount = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const summary = debts.map(([currency, value]) => `${amount(value)} ${names[currency] || currency}`).join('، ');
  // Existing and custom templates use the pair {balance} {currency}.
  // With multiple currencies the first token includes each amount and its unit.
  return {
    balance: debts.length === 1 ? amount(debts[0][1]) : summary || '0',
    currency: debts.length === 1 ? names[debts[0][0]] || debts[0][0] : '',
    summary,
  };
}
