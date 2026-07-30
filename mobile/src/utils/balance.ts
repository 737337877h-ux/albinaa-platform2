/**
 * Balance calculation utilities.
 * Mirrors the backend's operationalBalance formula:
 *   operationalBalance = accountingBalance + Σ(amountSigned since last import)
 *
 * Imported by balance tests to verify the contract end-to-end.
 */

export interface LedgerEntry {
  entryType: string;
  amountSigned: number;
}

export interface BalanceInput {
  accountingBalance: number;
  ledgerEntries: LedgerEntry[];
}

export interface BalanceResult {
  accountingBalance: number;
  operationalBalance: number;
}

export function computeBalance(input: BalanceInput): BalanceResult {
  const ledgerDelta = input.ledgerEntries.reduce(
    (sum, e) => sum + (Number(e.amountSigned) || 0),
    0,
  );
  return {
    accountingBalance: Number(input.accountingBalance),
    operationalBalance: Number(input.accountingBalance) + ledgerDelta,
  };
}

export function applyLedgerEntries(
  balance: { accountingBalance: number; operationalBalance: number },
  entry: LedgerEntry,
): { accountingBalance: number; operationalBalance: number } {
  return {
    accountingBalance: balance.accountingBalance,
    operationalBalance: balance.operationalBalance + (Number(entry.amountSigned) || 0),
  };
}
