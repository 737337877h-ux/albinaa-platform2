import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './guards/jwt-auth.guard';

type AssignedReceiptCollector = { id: string; oracleCollectorNo: number | null; user: { fullName: string } };
type UnassignedReceiptCollector = { id: null; oracleCollectorNo: null; user: { fullName: string } };
type OracleReceiptProjection<Collector> = {
  id: string; customerId: string; currencyCode: string; amount: number; collectedAt: string;
  status: string; receiptNumber: string | null; referenceNumber: string; notes: string | null;
  customer: { id: string; name: string; externalCustomerCode: string | null; assignments: Array<{ collectorId: string }> };
  collector: Collector; method: { name: string }; branch: null; source: string;
  externalCustomerCode: string; sourceReferenceNumber: string | null;
  settlementKey: string; sourceCreatedAt: Date | null; datePrecision: 'day';
};
export type AssignedOracleReceipt = OracleReceiptProjection<AssignedReceiptCollector>;
export type OracleHistoryReceipt = OracleReceiptProjection<AssignedReceiptCollector | UnassignedReceiptCollector>;

// Assigned-only callers retain their non-null collector contract. The history
// option is additionally permission-checked at runtime, including non-HTTP calls.
export function oracleReceiptActivity(prisma: PrismaService, actor: AuthUser, day?: string): Promise<AssignedOracleReceipt[]>;
export function oracleReceiptActivity(prisma: PrismaService, actor: AuthUser, day: string | undefined,
  options: { includeUnassigned: true }): Promise<OracleHistoryReceipt[]>;
/** Reporting projection only: Oracle movements already affect the balance import. */
export async function oracleReceiptActivity(prisma: PrismaService, actor: AuthUser, day?: string,
  options?: { includeUnassigned: true }): Promise<OracleHistoryReceipt[]> {
  const includeUnassigned = options?.includeUnassigned === true && actor.permissions.includes('customers.read_all');
  const run = await prisma.oracleMovementSyncRun.findFirst({
    where: { organizationId: actor.organizationId, sourceSchema: 'IAS20261', status: 'published' },
    orderBy: { startedAt: 'desc' }, select: { id: true },
  });
  if (!run) return [];
  const collectors = await prisma.collector.findMany({
    where: { active: true, user: { organizationId: actor.organizationId },
      ...(actor.permissions.includes('customers.read_all') ? {} : { userId: actor.id }) },
    select: { id: true, oracleCollectorNo: true, user: { select: { fullName: true } } },
  });
  const byNumber = new Map(collectors.filter((c) => c.oracleCollectorNo != null)
    .map((c) => [String(c.oracleCollectorNo), c]));
  const byId = new Map(collectors.map(collector => [collector.id, collector]));
  if (!collectors.length && !includeUnassigned) return [];
  const rows = await prisma.oracleCustomerMovementMirror.findMany({
    where: { syncRunId: run.id, organizationId: actor.organizationId,
      ...(day ? { documentDate: new Date(`${day}T00:00:00Z`) } : {}), documentType: '2',
      ...(includeUnassigned ? {} : { OR: [
        { collectorNo: { in: [...byNumber.keys()] } },
        { collectorNo: null }, { collectorNo: '' }, { collectorNo: '0' },
      ] }) },
  });
  const customers = await prisma.customer.findMany({
    where: { organizationId: actor.organizationId, externalCustomerCode: { in: [...new Set(rows.map((r) => r.externalCustomerCode))] } },
    select: { id: true, name: true, externalCustomerCode: true,
      assignments: { where: { effectiveTo: null }, orderBy: { effectiveFrom: 'desc' }, take: 1,
        select: { collectorId: true } },
    },
  });
  const byCode = new Map(customers.map((c) => [c.externalCustomerCode, c]));
  const receiptKeys = [...new Set(rows.map((row) => row.documentSerial?.trim() || row.documentNumber?.trim()).filter(Boolean) as string[])];
  const existing = receiptKeys.length ? await prisma.collection.findMany({
    where: { customer: { organizationId: actor.organizationId }, status: { not: 'reversed' },
      OR: [{ referenceNumber: { in: receiptKeys } }, { receiptNumber: { in: receiptKeys } }] },
    select: { referenceNumber: true, receiptNumber: true, customerId: true, currencyCode: true },
  }) : [];
  const existingKeys = new Set(existing.flatMap((row) => [row.referenceNumber, row.receiptNumber]
    .filter(Boolean).map((value) => `${value}|${row.customerId}|${row.currencyCode}`)));
  const grouped = new Map<string, OracleHistoryReceipt>();
  for (const row of rows) {
    const customer = byCode.get(row.externalCustomerCode);
    // A direct Oracle receipt can omit COL_NO. Attribute it to the customer's
    // current platform assignment, restricted to this caller's collector scope.
    // An explicit Oracle collector remains authoritative; never reassign a
    // different collector's receipt merely because it is not visible to a caller.
    const oracleCollectorNo = row.collectorNo?.trim();
    const mappedCollector = oracleCollectorNo && oracleCollectorNo !== '0'
      ? byNumber.get(oracleCollectorNo)
      : byId.get(customer?.assignments[0]?.collectorId ?? '');
    if (!customer || (!mappedCollector && !includeUnassigned)) continue;
    const collector: AssignedReceiptCollector | UnassignedReceiptCollector = mappedCollector
      ?? { id: null, oracleCollectorNo: null, user: { fullName: 'غير مسند' } };
    const receiptKey = row.documentSerial?.trim() || row.documentNumber?.trim();
    if (!receiptKey) continue;
    const currencyCode = ({ YR: 'YER', SR: 'SAR', '$': 'USD' } as Record<string, string>)[row.currencyCode] ?? row.currencyCode;
    // Oracle's local currency is SAR; foreign columns hold the document currency.
    const amount = currencyCode === 'SAR' ? Number(row.creditLocal) - Number(row.debitLocal)
      : Number(row.creditForeign) - Number(row.debitForeign);
    if (!Number.isFinite(amount) || existingKeys.has(`${receiptKey}|${customer.id}|${currencyCode}`)) continue;
    const key = `${receiptKey}|${customer.id}|${currencyCode}|${collector.id ?? 'unassigned'}`;
    const previous = grouped.get(key);
    if (previous) { previous.amount += amount; continue; }
    grouped.set(key, { id: `oracle-direct:${key}`, customerId: customer.id, customer, collector,
      currencyCode, amount, collectedAt: `${day ?? row.documentDate.toISOString().slice(0, 10)}T00:00:00+03:00`, status: 'recorded',
      receiptNumber: row.documentNumber, referenceNumber: receiptKey, notes: row.description,
      method: { name: 'سند قبض Oracle' }, branch: null, source: 'oracle_direct_receipt',
      externalCustomerCode: row.externalCustomerCode, sourceReferenceNumber: row.referenceNumber ?? null,
      settlementKey: `IAS20261|${row.documentSerial?.trim() || `${row.documentDate?.getUTCFullYear() ?? day?.slice(0,4)}:${row.documentNumber}`}|${customer.id}|${currencyCode}`,
      sourceCreatedAt: row.sourceCreatedAt ?? null, datePrecision: 'day' });
  }
  return [...grouped.values()].filter((receipt) => receipt.amount > 0);
}
