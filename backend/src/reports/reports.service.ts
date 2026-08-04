import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { calculateCei, calculateDso, safePercent, weightedDebtAge } from './kpi-calculator';
import { UpdateCollectorTargetDto } from './dto/update-collector-target.dto';

const key = (a: string, b: string) => `${a}|${b}`;
const monthKey = (date: Date) => date.toISOString().slice(0, 7);
const monthStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const nextMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async updateTarget(actor: AuthUser, collectorId: string, currencyCode: string, dto: UpdateCollectorTargetDto, req?: Request) {
    const collector = await this.prisma.collector.findFirst({ where: { id: collectorId, user: { organizationId: actor.organizationId } } });
    if (!collector) throw new NotFoundException('المحصل غير موجود ضمن المنشأة');
    if (!await this.prisma.currency.findFirst({ where: { code: currencyCode, active: true } })) throw new BadRequestException('العملة غير معروفة أو معطلة');
    const month = monthStart(new Date(dto.month));
    const before = await this.prisma.collectorTarget.findUnique({ where: { collectorId_currencyCode_month: { collectorId, currencyCode, month } } });
    const target = await this.prisma.collectorTarget.upsert({
      where: { collectorId_currencyCode_month: { collectorId, currencyCode, month } },
      update: { targetAmount: dto.targetAmount, setBy: actor.id },
      create: { collectorId, currencyCode, month, targetAmount: dto.targetAmount, setBy: actor.id },
    });
    await this.audit.log({ userId: actor.id, action: 'collector_target_updated', entityTable: 'collector_targets', entityId: target.id, oldValue: before, newValue: target, req });
    return target;
  }

  async kpi(actor: AuthUser) {
    const now = new Date();
    const currentStart = monthStart(now);
    const seriesStart = new Date(Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth() - 11, 1));
    const seriesEnd = nextMonth(currentStart);
    const previousStart = new Date(Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth() - 1, 1));
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const tomorrow = new Date(todayStart.getTime() + 86_400_000);

    const balances = await this.prisma.customerBalance.findMany({
      where: { customer: { organizationId: actor.organizationId, status: { notIn: ['merged', 'import_reversed'] } } },
      include: { lastImportJob: { select: { id: true, importedAt: true } } },
    });
    const customerIds = [...new Set(balances.map((x) => x.customerId))];
    const jobIds = [...new Set(balances.map((x) => x.lastImportJobId).filter((x): x is string => !!x))];
    const [transactions, ledger, collections, promises, snapshots, targets, collectors] = await Promise.all([
      this.prisma.importedTransaction.findMany({ where: { importJobId: { in: jobIds }, customerId: { in: customerIds }, reversedAt: null, txDate: { lt: seriesEnd } } }),
      this.prisma.operationalLedger.findMany({ where: { customerId: { in: customerIds }, createdAt: { lt: seriesEnd } } }),
      this.prisma.collection.findMany({ where: { collector: { user: { organizationId: actor.organizationId } }, status: { not: 'reversed' }, collectedAt: { gte: seriesStart, lt: seriesEnd } }, include: { collector: { include: { user: { select: { fullName: true } } } } } }),
      this.prisma.paymentPromise.findMany({ where: { collector: { user: { organizationId: actor.organizationId } }, dueDate: { gte: seriesStart, lt: seriesEnd } }, include: { collector: { include: { user: { select: { fullName: true } } } } } }),
      this.prisma.agingSnapshot.findMany({ where: { organizationId: actor.organizationId, asOf: { gte: seriesStart, lt: seriesEnd } } }),
      this.prisma.collectorTarget.findMany({ where: { collector: { user: { organizationId: actor.organizationId } }, month: { gte: seriesStart, lt: seriesEnd } } }),
      this.prisma.collector.findMany({ where: { active: true, user: { organizationId: actor.organizationId } }, include: { user: { select: { fullName: true } } } }),
    ]);

    const txByBalance = new Map<string, typeof transactions>();
    for (const tx of transactions) txByBalance.set(key(tx.customerId, tx.currencyCode), [...(txByBalance.get(key(tx.customerId, tx.currencyCode)) ?? []), tx]);
    const ledgerByBalance = new Map<string, typeof ledger>();
    for (const entry of ledger) ledgerByBalance.set(key(entry.customerId, entry.currencyCode), [...(ledgerByBalance.get(key(entry.customerId, entry.currencyCode)) ?? []), entry]);
    const snapshotByMonthCurrency = new Map<string, typeof snapshots>();
    for (const row of snapshots) snapshotByMonthCurrency.set(key(monthKey(row.asOf), row.currencyCode), [...(snapshotByMonthCurrency.get(key(monthKey(row.asOf), row.currencyCode)) ?? []), row]);

    const months = Array.from({ length: 12 }, (_, index) => new Date(Date.UTC(seriesStart.getUTCFullYear(), seriesStart.getUTCMonth() + index, 1)));
    const currencies = [...new Set([...balances.map((x) => x.currencyCode), ...collections.map((x) => x.currencyCode), ...targets.map((x) => x.currencyCode)])].sort();
    const trend = currencies.flatMap((currency) => months.map((month) => {
      const start = monthStart(month); const end = nextMonth(month);
      let opening = 0; let closing = 0; let sales = 0;
      for (const balance of balances.filter((x) => x.currencyCode === currency)) {
        const txs = (txByBalance.get(key(balance.customerId, currency)) ?? []).filter((x) => x.importJobId === balance.lastImportJobId);
        const entries = (ledgerByBalance.get(key(balance.customerId, currency)) ?? []).filter((x) => !balance.lastImportJob || x.createdAt > balance.lastImportJob.importedAt);
        const base = Number(balance.openingDebit) - Number(balance.openingCredit);
        const at = (date: Date) => base
          + txs.filter((x) => x.txDate < date).reduce((sum, x) => sum + Number(x.debit) - Number(x.credit), 0)
          + entries.filter((x) => x.createdAt < date).reduce((sum, x) => sum + Number(x.amountSigned), 0);
        opening += Math.max(0, at(start)); closing += Math.max(0, at(end));
        sales += txs.filter((x) => x.txDate >= start && x.txDate < end).reduce((sum, x) => sum + Number(x.debit), 0);
      }
      const monthSnapshots = snapshotByMonthCurrency.get(key(monthKey(month), currency)) ?? [];
      const currentReceivables = monthSnapshots.length ? monthSnapshots.reduce((sum, x) => sum + Number(x.bucket_0_30), 0) : null;
      const buckets = monthSnapshots.reduce((acc, x) => ({
        bucket_0_30: acc.bucket_0_30 + Number(x.bucket_0_30), bucket_31_60: acc.bucket_31_60 + Number(x.bucket_31_60),
        bucket_61_90: acc.bucket_61_90 + Number(x.bucket_61_90), bucket_91_120: acc.bucket_91_120 + Number(x.bucket_91_120),
        bucket_120_plus: acc.bucket_120_plus + Number(x.bucket_120_plus), undated: acc.undated + Number(x.undated),
      }), { bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_91_120: 0, bucket_120_plus: 0, undated: 0 });
      return {
        month: monthKey(month), currency, opening, sales, closing,
        dso: calculateDso(closing, sales, new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate()),
        cei: calculateCei(opening, sales, closing, currentReceivables),
        averageDebtAge: monthSnapshots.length ? weightedDebtAge(buckets) : null,
        undatedDebt: buckets.undated,
        closedSnapshot: monthSnapshots.length > 0,
      };
    }));

    const targetMap = new Map(targets.map((x) => [key(`${x.collectorId}|${monthKey(x.month)}`, x.currencyCode), Number(x.targetAmount)]));
    const rows = collectors.flatMap((collector) => currencies.map((currency) => {
      const currentCollections = collections.filter((x) => x.collectorId === collector.id && x.currencyCode === currency && x.collectedAt >= currentStart);
      const previousCollections = collections.filter((x) => x.collectorId === collector.id && x.currencyCode === currency && x.collectedAt >= previousStart && x.collectedAt < currentStart);
      const amount = currentCollections.reduce((sum, x) => sum + Number(x.amount), 0);
      const previousAmount = previousCollections.reduce((sum, x) => sum + Number(x.amount), 0);
      const dailyAmount = currentCollections.filter((x) => x.collectedAt >= todayStart && x.collectedAt < tomorrow).reduce((sum, x) => sum + Number(x.amount), 0);
      const relevantPromises = promises.filter((x) => x.collectorId === collector.id && x.currencyCode === currency && x.dueDate >= currentStart);
      const fulfilled = relevantPromises.filter((x) => x.status === 'fulfilled').length;
      const promiseRate = safePercent(fulfilled, relevantPromises.length);
      const target = targetMap.get(key(`${collector.id}|${monthKey(currentStart)}`, currency)) ?? null;
      return { collectorId: collector.id, collectorName: collector.user.fullName, currency, dailyAmount, monthlyAmount: amount, previousMonthAmount: previousAmount, target, attainment: target === null ? null : safePercent(amount, target), promisesFulfilled: fulfilled, promisesTotal: relevantPromises.length, promiseRate };
    }));

    const leaderboard = rows.map((row) => ({ ...row, score: (row.attainment ?? 0) * 0.6 + (row.promiseRate ?? 0) * 0.4 }));
    for (const currency of currencies) {
      const current = leaderboard.filter((x) => x.currency === currency).sort((a, b) => b.score - a.score);
      const previous = [...current].sort((a, b) => b.previousMonthAmount - a.previousMonthAmount);
      current.forEach((row, index) => Object.assign(row, { rank: index + 1, previousRank: previous.findIndex((x) => x.collectorId === row.collectorId) + 1, rankChange: previous.findIndex((x) => x.collectorId === row.collectorId) - index }));
    }
    const latestByCurrency = Object.fromEntries(currencies.map((currency) => {
      const series = trend.filter((x) => x.currency === currency);
      const latest = series[series.length - 1]; const previous = series[series.length - 2];
      return [currency, { ...latest, debtAgeDeterioration: latest.averageDebtAge !== null && previous?.averageDebtAge !== null ? latest.averageDebtAge - previous.averageDebtAge : null }];
    }));
    return { generatedAt: now, methodology: { dso: 'closing receivables ÷ credit sales × days', cei: '(opening + sales − closing) ÷ (opening + sales − current receivables)', currenciesSeparated: true }, latestByCurrency, trend, collectors: rows, leaderboard: leaderboard.sort((a, b) => a.currency.localeCompare(b.currency) || b.score - a.score), dataQuality: { monthsWithoutAgingSnapshot: trend.filter((x) => !x.closedSnapshot).map((x) => `${x.month}|${x.currency}`) } };
  }
}
