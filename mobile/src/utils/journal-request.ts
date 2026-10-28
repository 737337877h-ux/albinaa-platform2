export const ORACLE_JOURNAL_REFERENCE_MAX_LENGTH = 15;

export type JournalSide = 'debit' | 'credit';

export function hasDebitAndCredit<T extends { direction: JournalSide }>(lines: T[]) {
  return lines.some((line) => line.direction === 'debit')
    && lines.some((line) => line.direction === 'credit');
}

export function normalizeJournalReference(value: string) {
  return value.slice(0, ORACLE_JOURNAL_REFERENCE_MAX_LENGTH);
}

export function journalDryRunSuccessMessage(result: {
  localBalance?: unknown;
  localCurrency?: unknown;
}) {
  const localBalance = Number(result.localBalance ?? 0);
  const balance = Number.isFinite(localBalance) ? localBalance.toLocaleString('en-US') : '0';
  const currency = typeof result.localCurrency === 'string' && result.localCurrency.trim()
    ? ` ${result.localCurrency.trim()}` : '';
  return `تم التحقق حسب سعر صرف IAS20261.\nالفرق بعد التحويل: ${balance}${currency}`;
}
