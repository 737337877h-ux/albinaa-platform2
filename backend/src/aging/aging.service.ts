import { Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AGING_BUCKETS, AgingAmounts, allocateFifo, provisionFor } from './aging-calculator';
import { AgingQueryDto } from './dto/aging-query.dto';

const DEFAULT_RATES = {
  bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0.10,
  bucket_91_120: 0.25, bucket_120_plus: 0.50, undated: 0,
};

@Injectable()
export class AgingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async report(actor: AuthUser, query: AgingQueryDto) {
    if (query.asOf) return this.snapshotReport(actor.organizationId, query.asOf, query.currency);
    return this.liveReport(actor.organizationId, new Date(), query.currency);
  }

  async createSnapshot(actor: AuthUser, req?: Request) {
    return this.createSnapshotAt(actor, this.dateOnly(new Date()), req);
  }

  async createMonthlySnapshots(asOf: Date) {
    const organizations = await this.prisma.organization.findMany({
      select: { users: { where: { isActive: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    for (const organization of organizations) {
      const user = organization.users[0];
      if (!user) continue;
      await this.createSnapshotAt({ ...user, roles: [], permissions: [] }, this.dateOnly(asOf));
    }
  }

  private async createSnapshotAt(actor: AuthUser, asOf: Date, req?: Request) {
    const report = await this.liveReport(actor.organizationId, asOf);
    await this.prisma.$transaction(async (tx) => {
      await tx.agingSnapshot.deleteMany({ where: { organizationId: actor.organizationId, asOf } });
      if (report.customers.length) {
        await tx.agingSnapshot.createMany({
          data: report.customers.map((row) => ({
            organizationId: actor.organizationId,
            customerId: String(row.customerId),
            currencyCode: row.currency,
            asOf,
            ...row.buckets,
            totalDue: row.totalDue,
            provisionAmount: row.provisionAmount,
          })),
        });
      }
    });
    await this.audit.log({
      userId: actor.id,
      action: 'aging_snapshot_created',
      entityTable: 'aging_snapshots',
      entityId: asOf.toISOString().slice(0, 10),
      newValue: { rows: report.customers.length, totals: report.totals },
      req,
    });
    return { asOf: asOf.toISOString().slice(0, 10), rows: report.customers.length };
  }

  private async liveReport(organizationId: string, asOf: Date, currency?: string) {
    const balances = await this.prisma.customerBalance.findMany({
      where: {
        customer: { organizationId, status: { notIn: ['merged', 'import_reversed'] } },
        ...(currency ? { currencyCode: currency } : {}),
      },
      include: {
        customer: { select: { id: true, name: true, externalCustomerCode: true } },
        lastImportJob: { select: { importedAt: true } },
      },
    });
    const customerIds = [...new Set(balances.map((x) => x.customerId))];
    const [transactions, ledger, setting] = await Promise.all([
      this.prisma.importedTransaction.findMany({
        where: { customerId: { in: customerIds }, reversedAt: null, txDate: { lte: asOf }, ...(currency ? { currencyCode: currency } : {}) },
        orderBy: [{ txDate: 'asc' }, { sourceRowNumber: 'asc' }],
      }),
      this.prisma.operationalLedger.findMany({
        where: { customerId: { in: customerIds }, createdAt: { lte: new Date(asOf.getTime() + 86_399_999) }, ...(currency ? { currencyCode: currency } : {}) },
      }),
      this.prisma.systemSetting.findUnique({
        where: { organizationId_key: { organizationId, key: 'aging_provision_rates' } },
      }),
    ]);
    const rates = { ...DEFAULT_RATES, ...((setting?.value as object | null) ?? {}) } as typeof DEFAULT_RATES;

    const transactionsByKey = new Map<string, typeof transactions>();
    for (const txn of transactions) {
      const key = `${txn.customerId}|${txn.currencyCode}`;
      transactionsByKey.set(key, [...(transactionsByKey.get(key) ?? []), txn]);
    }
    const ledgerByKey = new Map<string, typeof ledger>();
    for (const entry of ledger) {
      const key = `${entry.customerId}|${entry.currencyCode}`;
      ledgerByKey.set(key, [...(ledgerByKey.get(key) ?? []), entry]);
    }

    const customers = balances.map((balance) => {
      const key = `${balance.customerId}|${balance.currencyCode}`;
      const txns = transactionsByKey.get(key) ?? [];
      const ledgerDelta = (ledgerByKey.get(key) ?? [])
        .filter((x) => !balance.lastImportJob || x.createdAt > balance.lastImportJob.importedAt)
        .reduce((sum, x) => sum + Number(x.amountSigned), 0);
      const target = Number(balance.accountingBalance) + ledgerDelta;
      const charges = [
        { amount: Number(balance.openingDebit), date: null },
        ...txns.filter((x) => Number(x.debit) > 0).map((x) => ({ amount: Number(x.debit), date: x.txDate })),
      ];
      const payments = Number(balance.openingCredit) + txns.reduce((sum, x) => sum + Number(x.credit), 0);
      const buckets = allocateFifo(charges, payments, target, asOf);
      return {
        customerId: balance.customerId,
        customerCode: balance.customer.externalCustomerCode,
        customerName: balance.customer.name,
        currency: balance.currencyCode,
        buckets,
        totalDue: Object.values(buckets).reduce((sum, x) => sum + x, 0),
        provisionAmount: provisionFor(buckets, rates),
      };
    }).filter((row) => row.totalDue > 0.005);
    return this.formatReport(asOf, customers, rates, false);
  }

  private async snapshotReport(organizationId: string, rawDate: string, currency?: string) {
    const asOf = this.dateOnly(new Date(rawDate));
    const rows = await this.prisma.agingSnapshot.findMany({
      where: { organizationId, asOf, ...(currency ? { currencyCode: currency } : {}) },
      include: { customer: { select: { name: true, externalCustomerCode: true } } },
    });
    if (!rows.length) throw new NotFoundException('لا توجد لقطة أعمار ديون لهذا التاريخ');
    const customers = rows.map((row) => ({
      customerId: row.customerId,
      customerCode: row.customer.externalCustomerCode,
      customerName: row.customer.name,
      currency: row.currencyCode,
      buckets: Object.fromEntries(AGING_BUCKETS.map((key) => [key, Number(row[key])])) as AgingAmounts,
      totalDue: Number(row.totalDue),
      provisionAmount: Number(row.provisionAmount),
    }));
    return this.formatReport(asOf, customers, DEFAULT_RATES, true);
  }

  private formatReport(asOf: Date, customers: Array<{ currency: string; buckets: AgingAmounts; totalDue: number; provisionAmount: number } & Record<string, unknown>>, rates: typeof DEFAULT_RATES, snapshot: boolean) {
    const totals: Record<string, AgingAmounts & { totalDue: number; provisionAmount: number }> = {};
    for (const row of customers) {
      totals[row.currency] ??= { ...Object.fromEntries(AGING_BUCKETS.map((x) => [x, 0])) as AgingAmounts, totalDue: 0, provisionAmount: 0 };
      for (const bucket of AGING_BUCKETS) totals[row.currency][bucket] += row.buckets[bucket];
      totals[row.currency].totalDue += row.totalDue;
      totals[row.currency].provisionAmount += row.provisionAmount;
    }
    return { asOf: asOf.toISOString().slice(0, 10), snapshot, rates, totals, customers };
  }

  private dateOnly(value: Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
}
