import { Prisma } from '@prisma/client';

type Balance = { customerId: string; currencyCode: string; accountingBalance: unknown;
  lastImportJob: { importedAt: Date } | null };

// The caller supplies already organization-scoped balances. Each currency keeps
// its own import cutoff; never apply a global latest-import date.
export async function effectiveBalances<T extends Balance>(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>, rows: T[],
) {
  if (!rows.length) return [];
  const input = JSON.stringify(rows.map((r, i) => ({
    ordinal: i, customer_id: r.customerId, currency_code: r.currencyCode,
    imported_at: r.lastImportJob?.importedAt.toISOString() ?? null,
  })));
  const sums = await db.$queryRaw<Array<{ ordinal: number; amount: Prisma.Decimal }>>(Prisma.sql`
    SELECT b.ordinal, COALESCE(SUM(l.amount_signed), 0) AS amount
    FROM jsonb_to_recordset(${input}::jsonb)
      AS b(ordinal integer, customer_id uuid, currency_code text, imported_at timestamptz)
    LEFT JOIN operational_ledger l ON l.customer_id=b.customer_id
      AND l.currency_code=b.currency_code
      AND (b.imported_at IS NULL OR l.created_at > b.imported_at)
    GROUP BY b.ordinal
  `);
  const byOrdinal = new Map(sums.map((s) => [s.ordinal, Number(s.amount)]));
  return rows.map((row, i) => ({ ...row,
    effectiveBalance: Number(row.accountingBalance) + (byOrdinal.get(i) ?? 0),
  }));
}
