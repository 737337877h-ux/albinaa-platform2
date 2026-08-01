import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

/**
 * خدمة درجات المخاطر (PR 4) — الصيغة المعتمدة من مالك المنتج:
 *   عمر الدين 25 + قيمة الرصيد 20 + عمر آخر سداد 15 + وعود مكسورة 15 +
 *   لا يرد متكرر 10 + أيام منذ آخر متابعة 10 + طلبات تأجيل متكررة 5 = 100
 *
 * قواعد أساسية:
 *   - أرصدة كل عملة تُقيّم بشكل منفصل — لا تجمع العملات أبدًا.
 *   - درجة العميل = أعلى درجة بين عملاته (أعلى مخاطر يفوز).
 *   - أي جزء ناقص يُملأ بصفر مع سبب واضح في reasons (JSON).
 *   - إعادة الحساب idempotent: تحذف درجات المنظمة السابقة وتكتب سطرًا جديدًا لكل عميل.
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

const NO_ANSWER_RESULTS = ['لا يرد', 'الهاتف مغلق', 'مشغول'];
const GRACE_REQUEST_RESULTS = ['طلب تأجيل'];
const BROKEN_PROMISE_STATUS = 'unfulfilled';

interface AgingBuckets {
  b30: boolean;
  b60: boolean;
  b90: boolean;
  b120: boolean;
  b120Plus: boolean;
}

export function riskLevelOf(score: number): RiskLevel {
  if (score >= 76) return 'critical';
  if (score >= 51) return 'high';
  if (score >= 26) return 'medium';
  return 'low';
}

export function pointsForDebtAge(b: AgingBuckets): number {
  if (b.b120Plus) return 25;
  if (b.b120) return 20;
  if (b.b90) return 15;
  if (b.b60) return 10;
  if (b.b30) return 5;
  return 0;
}

export function pointsForBalancePercentile(pct: number): number {
  if (pct >= 90) return 20;
  if (pct >= 75) return 15;
  if (pct >= 50) return 10;
  return 5;
}

export function pointsForLastPaymentAge(days: number | null): number {
  if (days === null) return 0;
  if (days >= 90) return 15;
  if (days >= 60) return 12;
  if (days >= 30) return 8;
  if (days >= 1) return 4;
  return 1;
}

export function pointsForBrokenPromises(count: number): number {
  if (count >= 5) return 15;
  if (count >= 3) return 12;
  if (count >= 1) return 8;
  return 0;
}

export function pointsForNoAnswer(count: number): number {
  if (count >= 5) return 10;
  if (count >= 3) return 8;
  if (count >= 1) return 5;
  return 0;
}

export function pointsForDaysSinceFollowup(days: number | null): number {
  if (days === null) return 0;
  if (days > 30) return 10;
  if (days > 14) return 7;
  if (days > 7) return 4;
  return 1;
}

export function pointsForGraceRequests(count: number): number {
  if (count >= 3) return 5;
  if (count === 2) return 4;
  if (count === 1) return 2;
  return 0;
}

interface Factor {
  label: string;
  points: number;
  text: string;
}

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function buildFactors(input: {
  debtAge: { points: number; text: string };
  balanceAmount: { points: number; text: string };
  lastPaymentAge: { points: number; text: string };
  brokenPromises: { points: number; text: string };
  repeatedNoAnswer: { points: number; text: string };
  daysSinceLastFollowup: { points: number; text: string };
  repeatedGraceRequests: { points: number; text: string };
}): Record<string, Factor> {
  return {
    debtAge: { label: 'عمر الدين', ...input.debtAge },
    balanceAmount: { label: 'قيمة الرصيد', ...input.balanceAmount },
    lastPaymentAge: { label: 'عمر آخر سداد', ...input.lastPaymentAge },
    brokenPromises: { label: 'وعود مكسورة', ...input.brokenPromises },
    repeatedNoAnswer: { label: 'لا يرد متكرر', ...input.repeatedNoAnswer },
    daysSinceLastFollowup: { label: 'أيام منذ آخر متابعة', ...input.daysSinceLastFollowup },
    repeatedGraceRequests: { label: 'طلبات تأجيل متكررة', ...input.repeatedGraceRequests },
  };
}

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async recalculate(actor: AuthUser, req?: Request) {
    const orgId = actor.organizationId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [customers, balances, agingSummaries, aging, collections, brokenPromises, followups, followupResults, creditTxns] = await Promise.all([
      this.prisma.customer.findMany({
        where: { organizationId: orgId },
        select: { id: true, externalCustomerCode: true, name: true },
      }),
      this.prisma.customerBalance.findMany({
        where: { customer: { organizationId: orgId } },
        select: { customerId: true, currencyCode: true, accountingBalance: true },
      }),
      this.prisma.debtAgingSummary.findMany({
        where: { customer: { organizationId: orgId } },
        select: { customerId: true, currencyCode: true, totalDue: true },
      }),
      this.prisma.debtAgingDetail.findMany({
        where: { customer: { organizationId: orgId } },
        select: {
          customerId: true,
          currencyCode: true,
          bucket_0_30: true,
          bucket_31_60: true,
          bucket_61_90: true,
          bucket_91_120: true,
          bucket_120_plus: true,
        },
      }),
      this.prisma.collection.findMany({
        where: { customer: { organizationId: orgId }, status: { notIn: ['reversed'] } },
        select: { customerId: true, currencyCode: true, collectedAt: true },
      }),
      this.prisma.paymentPromise.findMany({
        where: { customer: { organizationId: orgId }, status: BROKEN_PROMISE_STATUS },
        select: { customerId: true },
      }),
      this.prisma.followup.findMany({
        where: { customer: { organizationId: orgId }, deletedAt: null },
        select: { customerId: true, resultId: true, followupAt: true },
      }),
      this.prisma.followupResult.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true },
      }),
      this.prisma.importedTransaction.findMany({
        where: { customer: { organizationId: orgId }, credit: { gt: 0 } },
        select: { customerId: true, currencyCode: true, txDate: true },
      }),
    ]);

    const noAnswerResultIds = new Set(
      followupResults.filter((r) => NO_ANSWER_RESULTS.includes(r.name)).map((r) => r.id),
    );
    const graceResultIds = new Set(
      followupResults.filter((r) => GRACE_REQUEST_RESULTS.includes(r.name)).map((r) => r.id),
    );

    const brokenCount = new Map<string, number>();
    for (const p of brokenPromises) brokenCount.set(p.customerId, (brokenCount.get(p.customerId) ?? 0) + 1);

    const noAnswerCount = new Map<string, number>();
    const graceCount = new Map<string, number>();
    const lastFollowupAt = new Map<string, Date>();
    for (const f of followups) {
      const prev = lastFollowupAt.get(f.customerId);
      if (!prev || f.followupAt > prev) lastFollowupAt.set(f.customerId, f.followupAt);
      if (noAnswerResultIds.has(f.resultId)) noAnswerCount.set(f.customerId, (noAnswerCount.get(f.customerId) ?? 0) + 1);
      if (graceResultIds.has(f.resultId)) graceCount.set(f.customerId, (graceCount.get(f.customerId) ?? 0) + 1);
    }

    const lastPaymentByCcy = new Map<string, Date>();
    for (const c of collections) {
      const key = `${c.customerId}|${c.currencyCode}`;
      const prev = lastPaymentByCcy.get(key);
      if (!prev || c.collectedAt > prev) lastPaymentByCcy.set(key, c.collectedAt);
    }
    for (const t of creditTxns) {
      const key = `${t.customerId}|${t.currencyCode}`;
      const prev = lastPaymentByCcy.get(key);
      if (!prev || t.txDate > prev) lastPaymentByCcy.set(key, t.txDate);
    }

    const agingBucketsByKey = new Map<string, AgingBuckets>();
    for (const a of aging) {
      const key = `${a.customerId}|${a.currencyCode}`;
      const cur = agingBucketsByKey.get(key) ?? { b30: false, b60: false, b90: false, b120: false, b120Plus: false };
      if (Number(a.bucket_0_30) > 0) cur.b30 = true;
      if (Number(a.bucket_31_60) > 0) cur.b60 = true;
      if (Number(a.bucket_61_90) > 0) cur.b90 = true;
      if (Number(a.bucket_91_120) > 0) cur.b120 = true;
      if (Number(a.bucket_120_plus) > 0) cur.b120Plus = true;
      agingBucketsByKey.set(key, cur);
    }

    const balanceByKey = new Map<string, number>();
    const balanceByCurrency = new Map<string, number[]>();
    const trackBalance = (customerId: string, currencyCode: string, value: number) => {
      if (value > 0) {
        const key = `${customerId}|${currencyCode}`;
        if (!balanceByKey.has(key)) {
          balanceByKey.set(key, value);
          const list = balanceByCurrency.get(currencyCode) ?? [];
          list.push(value);
          balanceByCurrency.set(currencyCode, list);
        }
      }
    };
    // المصدر الأساسي للرصيد: ملف أعمار الديون (إجمالي الدين الحالي) — ثم أرصدة الحسابات كمكمّل
    for (const s of agingSummaries) trackBalance(s.customerId, s.currencyCode, Number(s.totalDue));
    for (const b of balances) trackBalance(b.customerId, b.currencyCode, Number(b.accountingBalance));
    // النسبة المئوية لرصيد كل (عميل|عملة) داخل عملته — لتحديد نقاط "قيمة الرصيد"
    const percentileByKey = new Map<string, number>();
    for (const [key, value] of balanceByKey) {
      const currency = key.split('|')[1];
      const sorted = [...(balanceByCurrency.get(currency) ?? [])].sort((x, y) => x - y);
      const lower = sorted.reduce((n, v) => (v < value ? n + 1 : n), 0);
      percentileByKey.set(key, sorted.length > 0 ? (lower / sorted.length) * 100 : 0);
    }

    const currenciesOf = new Map<string, Set<string>>();
    for (const key of agingBucketsByKey.keys()) {
      const [cid, ccy] = key.split('|');
      const set = currenciesOf.get(cid) ?? new Set<string>();
      set.add(ccy);
      currenciesOf.set(cid, set);
    }
    for (const key of balanceByKey.keys()) {
      const [cid, ccy] = key.split('|');
      const set = currenciesOf.get(cid) ?? new Set<string>();
      set.add(ccy);
      currenciesOf.set(cid, set);
    }

    interface PerCurrencyScore {
      currency: string | null;
      score: number;
      riskLevel: RiskLevel;
      factors: Record<string, Factor>;
    }

    const rows: { customerId: string; score: number; riskLevel: RiskLevel; reasons: unknown }[] = [];

    for (const customer of customers) {
      const broken = brokenCount.get(customer.id) ?? 0;
      const noAnswer = noAnswerCount.get(customer.id) ?? 0;
      const grace = graceCount.get(customer.id) ?? 0;
      const lastF = lastFollowupAt.get(customer.id) ?? null;
      const daysSinceFollowup = lastF ? daysBetween(lastF, today) : null;

      const orgDims = {
        brokenPromises: {
          points: pointsForBrokenPromises(broken),
          text: broken > 0 ? `${broken} وعد مكسور` : 'لا توجد وعود مكسورة',
        },
        repeatedNoAnswer: {
          points: pointsForNoAnswer(noAnswer),
          text: noAnswer > 0 ? `${noAnswer} متابعة بلا رد (لا يرد/مغلق/مشغول)` : 'لا توجد متابعات بلا رد',
        },
        daysSinceLastFollowup: {
          points: pointsForDaysSinceFollowup(daysSinceFollowup),
          text: daysSinceFollowup === null ? 'لا توجد متابعات مسجلة' : `آخر متابعة منذ ${daysSinceFollowup} يوم`,
        },
        repeatedGraceRequests: {
          points: pointsForGraceRequests(grace),
          text: grace > 0 ? `${grace} طلب تأجيل` : 'لا توجد طلبات تأجيل',
        },
      };

      const perCurrency: PerCurrencyScore[] = [];
      const currencies = currenciesOf.get(customer.id);
      const ccyList = currencies ? [...currencies].sort() : [];

      if (ccyList.length === 0) {
        const score =
          orgDims.brokenPromises.points +
          orgDims.repeatedNoAnswer.points +
          orgDims.daysSinceLastFollowup.points +
          orgDims.repeatedGraceRequests.points;
        const factors = buildFactors({
          debtAge: { points: 0, text: 'لا توجد بيانات أعمار ديون' },
          balanceAmount: { points: 0, text: 'لا يوجد رصيد مدين مسجل' },
          lastPaymentAge: { points: 0, text: 'لا يوجد سداد مسجل' },
          ...orgDims,
        });
        perCurrency.push({ currency: null, score, riskLevel: riskLevelOf(score), factors });
      }

      for (const ccy of ccyList) {
        const ageKey = `${customer.id}|${ccy}`;
        const buckets = agingBucketsByKey.get(ageKey) ?? { b30: false, b60: false, b90: false, b120: false, b120Plus: false };
        const debtAge = pointsForDebtAge(buckets);
        const debtAgeText =
          debtAge >= 25 ? 'أقدم شريحة دين تتجاوز 120 يوم'
          : debtAge >= 20 ? 'دين يصل إلى 91–120 يوم'
          : debtAge >= 15 ? 'دين يصل إلى 61–90 يوم'
          : debtAge >= 10 ? 'دين يصل إلى 31–60 يوم'
          : debtAge >= 5 ? 'دين حديث (حتى 30 يوم)'
          : 'لا توجد بيانات أعمار ديون';

        const balance = balanceByKey.get(ageKey) ?? 0;
        const pct = percentileByKey.get(ageKey) ?? 0;
        const balanceAmount = balance > 0 ? pointsForBalancePercentile(pct) : 0;
        const balanceLabel =
          balance === 0 ? 'لا يوجد رصيد مدين مسجل'
          : pct >= 90 ? `رصيد (${ccy}) ${fmtAmount(balance)} — مرتفع جدًا`
          : pct >= 75 ? `رصيد (${ccy}) ${fmtAmount(balance)} — مرتفع`
          : pct >= 50 ? `رصيد (${ccy}) ${fmtAmount(balance)} — متوسط`
          : `رصيد (${ccy}) ${fmtAmount(balance)} — منخفض`;

        const lastPayKey = `${customer.id}|${ccy}`;
        const lastPayAt = lastPaymentByCcy.get(lastPayKey) ?? null;
        const lastPayDays = lastPayAt ? daysBetween(lastPayAt, today) : null;
        const lastPaymentAge = pointsForLastPaymentAge(lastPayDays);
        const lastPaymentText =
          lastPayDays === null ? 'لا يوجد سداد مسجل'
          : lastPayDays >= 90 ? `آخر سداد منذ ${lastPayDays} يوم (أكثر من 90 يوم)`
          : `آخر سداد منذ ${lastPayDays} يوم`;

        const factors = buildFactors({
          debtAge: { points: debtAge, text: debtAgeText },
          balanceAmount: { points: balanceAmount, text: balanceLabel },
          lastPaymentAge: { points: lastPaymentAge, text: lastPaymentText },
          ...orgDims,
        });

        const score = debtAge + balanceAmount + lastPaymentAge + orgDims.brokenPromises.points + orgDims.repeatedNoAnswer.points + orgDims.daysSinceLastFollowup.points + orgDims.repeatedGraceRequests.points;
        perCurrency.push({ currency: ccy, score, riskLevel: riskLevelOf(score), factors });
      }

      const winner = perCurrency.reduce<PerCurrencyScore | null>(
        (best, cur) => (best === null || cur.score > best.score ? cur : best),
        null,
      );
      if (!winner) continue;

      rows.push({
        customerId: customer.id,
        score: winner.score,
        riskLevel: winner.riskLevel,
        reasons: {
          factors: winner.factors,
          perCurrency: perCurrency.map((p) => ({
            currency: p.currency,
            score: p.score,
            riskLevel: p.riskLevel,
            factors: p.factors,
          })),
        },
      });
    }

    const data = rows.map((row) => ({
      customerId: row.customerId,
      score: new Prisma.Decimal(row.score),
      riskLevel: row.riskLevel,
      reasons: row.reasons as Prisma.InputJsonValue,
    }));
    await this.prisma.$transaction(
      async (tx) => {
        await tx.customerScore.deleteMany({ where: { customer: { organizationId: orgId } } });
        await tx.customerScore.createMany({ data });
      },
      { timeout: 30_000 },
    );

    const byLevel = { low: 0, medium: 0, high: 0, critical: 0 } as Record<RiskLevel, number>;
    for (const r of rows) byLevel[r.riskLevel] += 1;

    await this.audit.log({
      userId: actor.id,
      action: 'risk_recalculated',
      entityTable: 'customer_scores',
      newValue: { totalCustomers: rows.length, byLevel },
      reason: `إعادة احتساب درجات المخاطر (${rows.length} عميل)`,
      req,
    });

    this.logger.log(`تم احتساب درجات المخاطر لـ ${rows.length} عميل (org ${orgId})`);
    return {
      organizationId: orgId,
      recalculatedAt: new Date().toISOString(),
      totalCustomers: customers.length,
      scoredCustomers: rows.length,
      byRiskLevel: byLevel,
    };
  }

  async findForCustomer(actor: AuthUser, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: actor.organizationId },
      select: { id: true, externalCustomerCode: true, name: true },
    });
    if (!customer) throw new NotFoundException('العميل غير موجود في هذه المنظمة');
    const latest = await this.prisma.customerScore.findFirst({
      where: { customerId },
      orderBy: { computedAt: 'desc' },
      take: 1,
    });
    if (!latest) throw new NotFoundException('لا توجد درجة مخاطر محسوبة بعد — نفّذ إعادة الاحتساب أولاً');
    return {
      customerId: customer.id,
      customerCode: customer.externalCustomerCode,
      customerName: customer.name,
      score: Number(latest.score),
      riskLevel: latest.riskLevel,
      reasons: latest.reasons,
      computedAt: latest.computedAt,
    };
  }
}
