import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { OracleAccountStatementReader } from '../customers/oracle-account-statement.reader';

export const ADVANCE_LEDGER_PROFILE = 'ORACLE_ADVANCES_LEDGER';
export interface AdvanceOpeningApproval {
  sourceOpening: number;
  adjustment: number;
  approvedBy: string;
  approvedAt: string;
  reason: string;
}
export type AdvanceStatement = Awaited<ReturnType<OracleAccountStatementReader['read']>> & {
  openingReconciliation?: AdvanceOpeningApproval;
};

/** Apply only the reviewed opening difference; new discrepancies still fail closed. */
export function reconcileApprovedAdvanceOpening(report: AdvanceStatement, expectedBalance: number,
  approval?: AdvanceOpeningApproval): AdvanceStatement {
  validateAdvanceStatement(report, report.periodEndBalance);
  const expected = new Prisma.Decimal(expectedBalance).toDecimalPlaces(4);
  if (expected.equals(report.periodEndBalance) || !approval) return report;
  if (!Number.isFinite(approval.sourceOpening) || !Number.isFinite(approval.adjustment)
    || !approval.approvedBy || !approval.approvedAt || !approval.reason) throw new Error('Invalid opening approval');
  const shift = new Prisma.Decimal(approval.adjustment);
  if (!new Prisma.Decimal(report.openingBalance).equals(approval.sourceOpening)
    || !new Prisma.Decimal(report.periodEndBalance).plus(shift).equals(expected)) {
    throw new Error('Source changed beyond the approved opening reconciliation');
  }
  const shifted = (value: number) => new Prisma.Decimal(value).plus(shift).toNumber();
  return { ...report, openingBalance: shifted(report.openingBalance), periodStartBalance: shifted(report.periodStartBalance),
    periodEndBalance: expected.toNumber(), currentBalance: expected.toNumber(), accountingBalance: expected.toNumber(),
    openingReconciliation: approval,
    items: report.items.map(row => ({ ...row, runningBalance: shifted(row.runningBalance) })),
  };
}

/** A complete, reconciled snapshot is required before any platform write. */
export function validateAdvanceStatement(report: AdvanceStatement, expectedBalance: number) {
  const decimal = (value: number) => {
    if (!Number.isFinite(value)) throw new Error('Non-finite advance amount');
    return new Prisma.Decimal(value).toDecimalPlaces(4);
  };
  if (report.source !== 'oracle_archive' || report.total !== report.items.length) {
    throw new Error('Incomplete advance statement');
  }
  let running = decimal(report.openingBalance);
  for (const row of report.items) {
    const debit = decimal(row.debit), credit = decimal(row.credit);
    if (debit.isNegative() || credit.isNegative() || !/^2026-\d\d-\d\d$/.test(row.date)) {
      throw new Error('Invalid advance movement');
    }
    running = running.plus(debit).minus(credit);
    if (!running.equals(decimal(row.runningBalance))) throw new Error('Advance running balance mismatch');
  }
  if (!running.equals(decimal(report.periodEndBalance)) || !running.equals(decimal(expectedBalance))) {
    throw new Error('Advance statement does not reconcile with Oracle balance');
  }
  return createHash('sha256').update(JSON.stringify({
    profile: ADVANCE_LEDGER_PROFILE, currency: report.currency,
    opening: report.openingBalance, balance: expectedBalance,
    ...(report.openingReconciliation ? { openingReconciliation: report.openingReconciliation } : {}),
    items: report.items,
  })).digest('hex');
}
