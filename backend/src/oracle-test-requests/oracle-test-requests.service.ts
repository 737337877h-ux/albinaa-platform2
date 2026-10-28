import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isActionableDebtorBalance, normalizedCurrencyCode } from '../common/debt-followup-policy';
import { durableOracleRequest, mergeOracleRequestRecords } from '../common/oracle-request-audit';
import { resolveReceiptAudit, latestReceiptByAudit } from '../common/oracle-receipt-binding';
import { oracleReceiptActivity } from '../common/oracle-receipt-activity';
import { reconcileReceiptRequests, recordedLocalReceiptFinals } from '../common/oracle-receipt-reconciliation';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

const ORACLE_WESTERN_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

export function normalizeOracleDocumentNumber(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(/[٠-٩۰-۹]/g, (digit) => ORACLE_WESTERN_DIGITS[digit] ?? digit);
}

@Injectable()
export class OracleTestRequestsService {
  private receiptStatusCache?: { expiresAt: number; items: Record<string,unknown>[] };
  private readonly enabled: boolean;
  private readonly baseUrl?: string;
  private readonly apiKey?: string;
  private readonly readBaseUrl?: string;
  private readonly readApiKey?: string;
  private readonly readSchema: string;
  private readonly testReadBaseUrl?: string;
  private readonly testReadApiKey?: string;
  private readonly testReadSchema: string;
  private readonly writeSchema: string;
  private readonly purchaseWriteEnabled: boolean;
  private readonly purchaseWriteBaseUrl?: string;
  private readonly purchaseWriteApiKey?: string;
  private readonly purchaseWriteSchema: string;
  private readonly receiptWriteEnabled: boolean;
  private readonly receiptWriteBaseUrl?: string;
  private readonly receiptWriteApiKey?: string;
  private readonly receiptWriteSchema: string;
  private readonly paymentWriteEnabled: boolean;
  private readonly paymentWriteBaseUrl?: string;
  private readonly paymentWriteApiKey?: string;
  private readonly paymentWriteSchema: string;
  private readonly journalWriteEnabled: boolean;
  private readonly journalWriteBaseUrl?: string;
  private readonly journalWriteApiKey?: string;
  private readonly journalWriteSchema: string;
  private readonly inventoryWriteEnabled: boolean;
  private readonly inventoryWriteBaseUrl?: string;
  private readonly inventoryWriteApiKey?: string;
  private readonly inventoryWriteSchema: string;

  constructor(config: ConfigService, private readonly prisma?: PrismaService) {
    this.enabled = config.get<string>('ORACLE_WRITE_ENABLED') === 'true';
    this.baseUrl = config.get<string>('ORACLE_WRITE_API_URL')?.replace(/\/$/, '');
    this.apiKey = config.get<string>('ORACLE_WRITE_API_KEY');
    this.readBaseUrl = config.get<string>('ORACLE_READ_API_URL')?.replace(/\/$/, '');
    this.readApiKey = config.get<string>('ORACLE_READ_API_KEY');
    this.readSchema = config.get<string>('ORACLE_READ_SCHEMA')?.trim().toUpperCase() || '';
    this.testReadBaseUrl = config.get<string>('ORACLE_TEST_READ_API_URL')?.replace(/\/$/, '');
    this.testReadApiKey = config.get<string>('ORACLE_TEST_READ_API_KEY');
    this.testReadSchema = config.get<string>('ORACLE_TEST_READ_SCHEMA')?.trim().toUpperCase() || '';
    this.writeSchema = config.get<string>('ORACLE_WRITE_SCHEMA')?.trim().toUpperCase() || '';
    this.purchaseWriteEnabled = config.get<string>('ORACLE_IAS20261_PURCHASE_WRITE_ENABLED') === 'true';
    this.purchaseWriteBaseUrl = config.get<string>('ORACLE_IAS20261_PURCHASE_WRITE_API_URL')?.replace(/\/$/, '');
    this.purchaseWriteApiKey = config.get<string>('ORACLE_IAS20261_PURCHASE_WRITE_API_KEY');
    this.purchaseWriteSchema = config.get<string>('ORACLE_IAS20261_PURCHASE_WRITE_SCHEMA')?.trim().toUpperCase() || '';
    this.receiptWriteEnabled = config.get<string>('ORACLE_IAS20261_RECEIPT_WRITE_ENABLED') === 'true';
    this.receiptWriteBaseUrl = config.get<string>('ORACLE_IAS20261_RECEIPT_WRITE_API_URL')?.replace(/\/$/, '');
    this.receiptWriteApiKey = config.get<string>('ORACLE_IAS20261_RECEIPT_WRITE_API_KEY');
    this.receiptWriteSchema = config.get<string>('ORACLE_IAS20261_RECEIPT_WRITE_SCHEMA')?.trim().toUpperCase() || '';
    this.paymentWriteEnabled = config.get<string>('ORACLE_IAS20261_PAYMENT_WRITE_ENABLED') === 'true';
    this.paymentWriteBaseUrl = config.get<string>('ORACLE_IAS20261_PAYMENT_WRITE_API_URL')?.replace(/\/$/, '');
    this.paymentWriteApiKey = config.get<string>('ORACLE_IAS20261_PAYMENT_WRITE_API_KEY');
    this.paymentWriteSchema = config.get<string>('ORACLE_IAS20261_PAYMENT_WRITE_SCHEMA')?.trim().toUpperCase() || '';
    this.journalWriteEnabled = config.get<string>('ORACLE_IAS20261_JOURNAL_WRITE_ENABLED') === 'true';
    this.journalWriteBaseUrl = config.get<string>('ORACLE_IAS20261_JOURNAL_WRITE_API_URL')?.replace(/\/$/, '');
    this.journalWriteApiKey = config.get<string>('ORACLE_IAS20261_JOURNAL_WRITE_API_KEY');
    this.journalWriteSchema = config.get<string>('ORACLE_IAS20261_JOURNAL_WRITE_SCHEMA')?.trim().toUpperCase() || '';
    this.inventoryWriteEnabled = config.get<string>('ORACLE_IAS20261_INVENTORY_WRITE_ENABLED') === 'true';
    this.inventoryWriteBaseUrl = config.get<string>('ORACLE_IAS20261_INVENTORY_WRITE_API_URL')?.replace(/\/$/, '');
    this.inventoryWriteApiKey = config.get<string>('ORACLE_IAS20261_INVENTORY_WRITE_API_KEY');
    this.inventoryWriteSchema = config.get<string>('ORACLE_IAS20261_INVENTORY_WRITE_SCHEMA')?.trim().toUpperCase() || '';
  }

  private oracleCurrencyToPlatform(code: unknown) {
    const normalized = normalizedCurrencyCode(String(code ?? ''));
    return normalized === 'YR' ? 'YER' : normalized === 'SR' ? 'SAR' : normalized;
  }

  private async receiptCollectorNo(input: Record<string, unknown>, actor?: AuthUser): Promise<number> {
    if (!this.prisma || !actor?.organizationId || !actor.id) {
      throw new BadRequestException('تعذر تحديد محصل سند القبض؛ أعد تسجيل الدخول وتحقق من ربط المحصل بأوراكل');
    }
    const supplied = input.collectorNo != null && String(input.collectorNo).trim() !== '';
    if (supplied && !['number', 'string'].includes(typeof input.collectorNo)) {
      throw new BadRequestException('رقم محصل سند القبض غير صالح');
    }
    let number = supplied ? Number(normalizeOracleDocumentNumber(input.collectorNo)) : null;
    if (!supplied) {
      // Older/offline mobile catalogs can omit assignedCollector. Resolve the
      // customer assignment from the server rather than trusting that snapshot.
      const lines = Array.isArray(input.lines) ? input.lines as Record<string, unknown>[] : [];
      const customerCodes = [...new Set(lines
        .filter(line => Number(line.analyticalType) === 3)
        .map(line => String(line.analyticalAccountCode ?? '').trim()).filter(Boolean))];
      if (customerCodes.length === 1) {
        const customer = await this.prisma.customer.findFirst({
          where: { organizationId: actor.organizationId, externalCustomerCode: customerCodes[0] },
          select: { assignments: {
            where: { effectiveTo: null }, orderBy: { effectiveFrom: 'desc' }, take: 1,
            select: { collector: { select: { active: true, oracleCollectorNo: true } } },
          } },
        });
        const assigned = customer?.assignments[0]?.collector;
        if (assigned?.active) number = assigned.oracleCollectorNo;
      }
      if (number == null) {
        const creator = await this.prisma.collector.findFirst({
          where: { userId: actor.id, active: true, user: { organizationId: actor.organizationId, isActive: true } },
          select: { oracleCollectorNo: true },
        });
        number = creator?.oracleCollectorNo ?? null;
      }
    }
    if (number == null || !Number.isSafeInteger(number) || number < 1) {
      throw new BadRequestException('رقم محصل سند القبض مفقود أو غير صالح؛ اربط المحصل برقم أوراكل الصحيح قبل الإرسال');
    }
    const collector = await this.prisma.collector.findFirst({
      where: { oracleCollectorNo: number, active: true, user: { organizationId: actor.organizationId, isActive: true } },
      select: { id: true },
    });
    if (!collector) {
      throw new BadRequestException('محصل سند القبض غير نشط أو غير مربوط بالمنشأة؛ راجع إعدادات المحصلين');
    }
    return number;
  }

  private async voucherWriterPayload(payload: unknown, actor?: AuthUser) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
    const { platformCustomerId: _platformCustomerId, platformCustomerCode: _platformCustomerCode,
      nextFollowupDate: _nextFollowupDate, ...writerPayload } = payload as Record<string, unknown>;
    writerPayload.referenceNo = normalizeOracleDocumentNumber(writerPayload.referenceNo);
    writerPayload.noticeNo = normalizeOracleDocumentNumber(writerPayload.noticeNo);
    if (String(writerPayload.kind) === 'receipt' && !String(writerPayload.recipientName ?? '').trim()
      && this.prisma && actor && (_platformCustomerId || _platformCustomerCode)) {
      const customer = await this.prisma.customer.findFirst({
        where: {
          organizationId: actor.organizationId,
          ...(_platformCustomerId
            ? { id: String(_platformCustomerId) }
            : { externalCustomerCode: String(_platformCustomerCode) }),
        },
        select: { name: true },
      });
      if (customer?.name?.trim()) writerPayload.recipientName = customer.name.trim();
    }
    if (String(writerPayload.kind) === 'receipt') {
      writerPayload.collectorNo = await this.receiptCollectorNo(writerPayload, actor);
    }
    return writerPayload;
  }

  private async receiptFollowupPlan(payload: unknown, actor?: AuthUser) {
    if (!this.prisma || !actor || !payload || typeof payload !== 'object') return null;
    const input = payload as Record<string, unknown>;
    if (String(input.kind) !== 'receipt') return null;
    const lines = Array.isArray(input.lines) ? input.lines as Array<Record<string, unknown>> : [];
    if (lines.length !== 1) return null;
    const platformCustomerId = typeof input.platformCustomerId === 'string' ? input.platformCustomerId : '';
    const platformCustomerCode = typeof input.platformCustomerCode === 'string' ? input.platformCustomerCode : '';
    if (!platformCustomerId && !platformCustomerCode) return null;
    const customer = await this.prisma.customer.findFirst({
      where: {
        organizationId: actor.organizationId,
        ...(platformCustomerId ? { id: platformCustomerId } : { externalCustomerCode: platformCustomerCode }),
      },
      select: {
        id: true,
        balances: {
          select: { currencyCode: true, accountingBalance: true, lastImportJob: { select: { importedAt: true } } },
        },
        assignments: {
          where: { effectiveTo: null }, orderBy: { effectiveFrom: 'desc' }, take: 1,
          select: { collectorId: true },
        },
      },
    });
    if (!customer) return null;
    const collectionCurrency = this.oracleCurrencyToPlatform(lines[0].currencyCode);
    const collectedAmount = Number(lines[0].amount);
    if (!collectionCurrency || !Number.isFinite(collectedAmount) || collectedAmount <= 0) return null;
    const balances = await Promise.all(customer.balances.map(async (balance) => {
      const ledger = await this.prisma!.operationalLedger.aggregate({
        _sum: { amountSigned: true },
        where: {
          customerId: customer.id,
          currencyCode: balance.currencyCode,
          ...(balance.lastImportJob ? { createdAt: { gt: balance.lastImportJob.importedAt } } : {}),
        },
      });
      const before = Number(balance.accountingBalance) + Number(ledger._sum.amountSigned ?? 0);
      const currency = this.oracleCurrencyToPlatform(balance.currencyCode);
      return { currency, before, projected: currency === collectionCurrency ? before - collectedAmount : before };
    }));
    const current = balances.find((balance) => balance.currency === collectionCurrency)
      ?? { currency: collectionCurrency, before: 0, projected: -collectedAmount };
    const partial = isActionableDebtorBalance(current.projected, current.currency);
    const hasOtherDebt = balances.some((balance) => isActionableDebtorBalance(balance.projected, balance.currency));
    const nextFollowupDate = typeof input.nextFollowupDate === 'string' ? input.nextFollowupDate.trim() : '';
    if (partial && !/^\d{4}-\d{2}-\d{2}$/.test(nextFollowupDate)) {
      throw new BadRequestException('التحصيل جزئي؛ حدد موعد المتابعة القادمة للمتبقي');
    }
    return {
      customerId: customer.id,
      collectorId: customer.assignments[0]?.collectorId ?? null,
      currency: current.currency,
      remainingAmount: Math.max(0, current.projected),
      partial,
      fullySettled: !hasOtherDebt,
      nextFollowupDate,
    };
  }

  private async applyReceiptFollowupPlan(plan: Awaited<ReturnType<OracleTestRequestsService['receiptFollowupPlan']>>, actor?: AuthUser) {
    if (!this.prisma || !actor || !plan) return null;
    await this.prisma.$transaction(async (tx) => {
      if (plan.fullySettled) {
        await tx.task.updateMany({
          where: { customerId: plan.customerId, status: 'open' },
          data: { status: 'done' },
        });
        return;
      }
      await tx.task.updateMany({
        where: {
          customerId: plan.customerId,
          status: 'open',
          OR: [{ expectedCurrency: plan.currency }, { expectedCurrency: null }],
        },
        data: { status: 'done' },
      });
      if (plan.partial) {
        await tx.task.create({
          data: {
            customerId: plan.customerId,
            assignedTo: plan.collectorId,
            createdBy: actor.id,
            taskType: 'collection_remaining',
            dueDate: new Date(`${plan.nextFollowupDate}T00:00:00.000Z`),
            priorityReason: 'متابعة المتبقي بعد تحصيل جزئي',
            expectedAmount: plan.remainingAmount,
            expectedCurrency: plan.currency,
            status: 'open',
          },
        });
      }
    });
    return {
      outcome: plan.fullySettled ? 'fully_settled' : plan.partial ? 'partial_followup_scheduled' : 'currency_settled',
      remainingAmount: plan.remainingAmount,
      currency: plan.currency,
      nextFollowupDate: plan.partial ? plan.nextFollowupDate : null,
    };
  }

  private async readCall(path: string, source: 'operational' | 'test' = 'operational') {
    const baseUrl = source === 'operational' ? this.readBaseUrl : this.testReadBaseUrl;
    const apiKey = source === 'operational' ? this.readApiKey : this.testReadApiKey;
    if (!baseUrl || !apiKey) {
      throw new ServiceUnavailableException('بوابة قراءة Oracle غير مهيأة');
    }
    let response: Response | null = null;
    let connectionError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetch(`${baseUrl}${path}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(20_000),
        });
        break;
      } catch (error) {
        connectionError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    if (!response) {
      throw new ServiceUnavailableException('بوابة قراءة Oracle غير متاحة مؤقتًا؛ ستعاد المزامنة المحاولة تلقائيًا', {
        cause: connectionError instanceof Error ? connectionError : undefined,
      });
    }
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const message = typeof result?.message === 'string' ? result.message : `فشل قراءة كتالوج Oracle (${response.status})`;
      throw new ServiceUnavailableException(message);
    }
    return result;
  }

  private inventoryCountParams(input: { documentNo: unknown; inventoryType: unknown; branchNo: unknown; branchYear: unknown }) {
    const values = {
      documentNo: Number(input.documentNo), inventoryType: Number(input.inventoryType),
      branchNo: Number(input.branchNo), branchYear: Number(input.branchYear),
    };
    if (!Object.values(values).every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new BadRequestException('بيانات مستند الجرد غير صالحة');
    }
    if (values.branchYear < 1900 || values.branchYear > 9999) {
      throw new BadRequestException('سنة الفرع غير صالحة');
    }
    return values;
  }

  private assertIsolated() {
    if (!this.enabled || !this.baseUrl || !this.apiKey) {
      throw new ServiceUnavailableException('بوابة طلبات Oracle التجريبية غير مفعلة');
    }
    if (this.readSchema !== 'IAS20261' || this.testReadSchema !== 'IAS20191' || this.writeSchema !== 'IAS20191') {
      throw new ServiceUnavailableException('مصدر القراءة يجب أن يكون IAS20261 والمسودات التجريبية IAS20191');
    }
  }

  private async call(path: string, method: 'GET' | 'POST', payload?: unknown) {
    this.assertIsolated();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const message = typeof result?.message === 'string' ? result.message : `فشل طلب Oracle التجريبي (${response.status})`;
      if (response.status === 409) throw new ConflictException(message);
      throw new ServiceUnavailableException(message);
    }
    return result;
  }

  private assertPurchaseWriter() {
    if (!this.purchaseWriteEnabled || !this.purchaseWriteBaseUrl || !this.purchaseWriteApiKey) {
      throw new ServiceUnavailableException('بوابة كتابة طلب الشراء IAS20261 غير مفعلة');
    }
    if (this.readSchema !== 'IAS20261' || this.purchaseWriteSchema !== 'IAS20261') {
      throw new ServiceUnavailableException('قراءة وكتابة طلب الشراء يجب أن تكونا على IAS20261');
    }
  }

  private async purchaseWriteCall(path: string, payload: unknown) {
    this.assertPurchaseWriter();
    const response = await fetch(`${this.purchaseWriteBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.purchaseWriteApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const message = typeof result?.message === 'string'
        ? result.message : `فشل طلب الشراء IAS20261 (${response.status})`;
      if (response.status === 400) throw new BadRequestException(message);
      if (response.status === 409) throw new ConflictException(message);
      throw new ServiceUnavailableException(message);
    }
    return result;
  }

  private assertReceiptWriter() {
    if (!this.receiptWriteEnabled || !this.receiptWriteBaseUrl || !this.receiptWriteApiKey) {
      throw new ServiceUnavailableException('بوابة كتابة سند القبض IAS20261 غير مفعلة');
    }
    if (this.readSchema !== 'IAS20261' || this.receiptWriteSchema !== 'IAS20261') {
      throw new ServiceUnavailableException('قراءة وكتابة سند القبض يجب أن تكونا على IAS20261');
    }
  }

  private async receiptWriteCall(path: string, payload: unknown) {
    this.assertReceiptWriter();
    const response = await fetch(`${this.receiptWriteBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.receiptWriteApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const message = typeof result?.message === 'string'
        ? result.message : `فشل سند القبض IAS20261 (${response.status})`;
      if (response.status === 400) throw new BadRequestException(message);
      if (response.status === 409) throw new ConflictException(message);
      throw new ServiceUnavailableException(message);
    }
    return result;
  }

  private assertPaymentWriter() {
    if (!this.paymentWriteEnabled || !this.paymentWriteBaseUrl || !this.paymentWriteApiKey) {
      throw new ServiceUnavailableException('بوابة كتابة سند الصرف IAS20261 غير مفعلة');
    }
    if (this.readSchema !== 'IAS20261' || this.paymentWriteSchema !== 'IAS20261') {
      throw new ServiceUnavailableException('قراءة وكتابة سند الصرف يجب أن تكونا على IAS20261');
    }
  }

  private async paymentWriteCall(path: string, payload: unknown) {
    this.assertPaymentWriter();
    const response = await fetch(`${this.paymentWriteBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.paymentWriteApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const message = typeof result?.message === 'string'
        ? result.message : `فشل سند الصرف IAS20261 (${response.status})`;
      if (response.status === 400) throw new BadRequestException(message);
      if (response.status === 409) throw new ConflictException(message);
      throw new ServiceUnavailableException(message);
    }
    return result;
  }

  private assertJournalWriter() {
    if (!this.journalWriteEnabled || !this.journalWriteBaseUrl || !this.journalWriteApiKey) {
      throw new ServiceUnavailableException('بوابة كتابة القيد اليومي IAS20261 غير مفعلة');
    }
    if (this.readSchema !== 'IAS20261' || this.journalWriteSchema !== 'IAS20261') {
      throw new ServiceUnavailableException('قراءة وكتابة القيد اليومي يجب أن تكونا على IAS20261');
    }
  }

  private async journalWriteCall(path: string, payload: unknown) {
    this.assertJournalWriter();
    const response = await fetch(`${this.journalWriteBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.journalWriteApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const message = typeof result?.message === 'string'
        ? result.message : `فشل القيد اليومي IAS20261 (${response.status})`;
      if (response.status === 400) throw new BadRequestException(message);
      if (response.status === 409) throw new ConflictException(message);
      throw new ServiceUnavailableException(message);
    }
    return result;
  }

  private assertInventoryWriter() {
    if (!this.inventoryWriteEnabled || !this.inventoryWriteBaseUrl || !this.inventoryWriteApiKey) {
      throw new ServiceUnavailableException('بوابة كتابة الجرد IAS20261 غير مفعلة');
    }
    if (this.readSchema !== 'IAS20261' || this.inventoryWriteSchema !== 'IAS20261') {
      throw new ServiceUnavailableException('قراءة وكتابة الجرد يجب أن تكونا على IAS20261');
    }
  }

  private async inventoryWriteCall(path: string, payload: unknown) {
    this.assertInventoryWriter();
    const response = await fetch(`${this.inventoryWriteBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.inventoryWriteApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const message = typeof result?.message === 'string'
        ? result.message : `فشل مسودة الجرد IAS20261 (${response.status})`;
      if (response.status === 400) throw new BadRequestException(message);
      if (response.status === 409) throw new ConflictException(message);
      throw new ServiceUnavailableException(message);
    }
    return result;
  }

  currencies() { return this.readCall(`/accounting/currencies?schema=${this.readSchema}`); }
  /** Read-only current states; callers still match against their scoped durable audits. */
  async receiptStatuses(): Promise<Record<string,unknown>[]> {
    if (!this.readBaseUrl || !this.readApiKey || this.readSchema !== 'IAS20261') return [];
    if (this.receiptStatusCache && this.receiptStatusCache.expiresAt > Date.now()) return this.receiptStatusCache.items;
    try {
      const result = await this.readCall('/requests/created?schema=IAS20261&limit=100&kind=receipt');
      const items = (Array.isArray(result?.items) ? result.items : []) as Record<string,unknown>[];
      this.receiptStatusCache = { expiresAt: Date.now()+60_000, items };
      return items;
    } catch { return []; }
  }

  async created(permissions: string[], actor?: AuthUser) {
    const permissionByKind: Record<string, string> = {
      purchase: 'oracle_test_requests.purchase.read',
      receipt: 'oracle_test_requests.receipt.read',
      payment: 'oracle_test_requests.payment.read',
      journal: 'oracle_test_requests.journal.read',
      inventory_count: 'oracle_test_requests.inventory_count.read',
      inventory_transfer: 'inventory_transfers.read',
    };
    const results: Array<Record<string, unknown>> = [];
    const warnings: Array<{ kind: string; schema: string; message: string }> = [];
    const readCreated = async (
      path: string,
      kind: string,
      schema: string,
      source: 'operational' | 'test' = 'operational',
    ) => {
      try {
        const result = await this.readCall(path, source);
        if (!result) throw new ServiceUnavailableException('أعادت بوابة Oracle استجابة حالات فارغة');
        results.push(result);
      } catch (error) {
        const fallback = error instanceof Error ? error.message : 'تعذر الاتصال ببوابة Oracle';
        warnings.push({ kind, schema, message: fallback });
      }
    };
    if (permissions.includes('oracle_test_requests.purchase.read') && this.readBaseUrl && this.readApiKey
      && this.readSchema === 'IAS20261') {
      await readCreated('/requests/created?schema=IAS20261&limit=100&kind=purchase', 'purchase', 'IAS20261');
    }
    if (this.receiptWriteEnabled && permissions.includes('oracle_test_requests.receipt.read') && this.readBaseUrl && this.readApiKey
      && this.readSchema === 'IAS20261') {
      await readCreated('/requests/created?schema=IAS20261&limit=100&kind=receipt', 'receipt', 'IAS20261');
    }
    if (this.paymentWriteEnabled && permissions.includes('oracle_test_requests.payment.read') && this.readBaseUrl && this.readApiKey
      && this.readSchema === 'IAS20261') {
      await readCreated('/requests/created?schema=IAS20261&limit=100&kind=payment', 'payment', 'IAS20261');
    }
    if (this.journalWriteEnabled && permissions.includes('oracle_test_requests.journal.read') && this.readBaseUrl && this.readApiKey
      && this.readSchema === 'IAS20261') {
      await readCreated('/requests/created?schema=IAS20261&limit=100&kind=journal', 'journal', 'IAS20261');
    }
    if (this.inventoryWriteEnabled && permissions.includes('oracle_test_requests.inventory_count.read') && this.readBaseUrl && this.readApiKey
      && this.readSchema === 'IAS20261') {
      await readCreated('/requests/created?schema=IAS20261&limit=100&kind=inventory_count', 'inventory_count', 'IAS20261');
    }
    if (permissions.includes('inventory_transfers.read') && this.readBaseUrl && this.readApiKey
      && this.readSchema === 'IAS20261') {
      await readCreated('/requests/created?schema=IAS20261&limit=100&kind=inventory_transfer', 'inventory_transfer', 'IAS20261');
    }
    const testReaderDuplicatesOperational = this.testReadBaseUrl === this.readBaseUrl
      && this.testReadApiKey === this.readApiKey
      && this.testReadSchema === this.readSchema;
    if (this.testReadBaseUrl && this.testReadApiKey && this.testReadSchema && !testReaderDuplicatesOperational) {
      await readCreated(`/requests/created?schema=${this.testReadSchema}&limit=100`, 'pilot', this.testReadSchema, 'test');
    }
    if (results.length === 0 && warnings.length === 0) {
      throw new ServiceUnavailableException('بوابة قراءة حالات طلبات Oracle غير مهيأة');
    }
    // لا تعتمد شاشة الطلبات على ذاكرة بوابة القراءة وحدها. سجل التدقيق في
    // قاعدة المنصة دائم، لذلك يبقى الطلب ظاهرًا بعد إعادة تشغيل البوابة أو
    // عند تعذرها، وتُفضّل نتيجة Oracle الحية لاحقًا لتحديث الحالة.
    const durableAuditRows = this.prisma && actor ? await this.prisma.auditLog.findMany({
      where: {
        action: 'oracle_test_request_created',
        entityTable: 'IAS20261',
        user: { organizationId: actor.organizationId },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { id: true, entityId: true, newValue: true, createdAt: true, userId: true },
    }) : [];
    const durableItems = durableAuditRows
      .map((row) => durableOracleRequest(row))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => {
        const required = permissionByKind[item.kind];
        return Boolean(required && permissions.includes(required));
      })
      .map((item) => ({
        kind: item.kind,
        requestNo: item.requestNo,
        requestSerial: item.requestSerial,
        status: item.status,
        createdAt: item.createdAt,
        amount: item.amount,
        currencyCode: item.currencyCode,
        platformCustomerId: item.platformCustomerId,
        platformCustomerCode: item.platformCustomerCode,
        recipientName: item.recipientName,
        collectorNo: item.collectorNo,
        externalReference: item.externalReference,
        paymentMethod: item.paymentMethod,
        cashOrBankNo: item.cashOrBankNo,
        description: item.description,
        referenceNo: item.referenceNo,
        durableAudit: true,
      }));
    const operationalKinds = new Set(results
      .filter((result) => result.schema === 'IAS20261')
      .flatMap((result) => (Array.isArray(result.items) ? result.items : []))
      .map((item) => String((item as Record<string, unknown>).kind ?? '')));
    const liveItems = results.flatMap((result) => (Array.isArray(result.items) ? result.items : []).map((item) => ({
      item, schema: String(result.schema ?? ''),
    })))
      .filter(({ item, schema }) => !operationalKinds.has(String((item as Record<string, unknown>).kind ?? ''))
        || schema === 'IAS20261')
      .map(({ item }) => item);
    const items = [...liveItems, ...durableItems];
    const uniqueItems = new Map<string, unknown>();
    for (const item of items) {
      const value = item as Record<string, unknown>;
      const key = `${String(value.kind ?? '')}|${String(value.requestSerial ?? value.requestNo ?? '')}`;
      const current = uniqueItems.get(key) as Record<string, unknown> | undefined;
      uniqueItems.set(key, current ? mergeOracleRequestRecords(current, value) : value);
    }
    const visibleItems = [...uniqueItems.values()].filter((item) => {
      const kind = String((item as Record<string, unknown>).kind ?? '');
      const required = permissionByKind[kind];
      return Boolean(required && permissions.includes(required));
    }) as Array<Record<string, unknown>>;
    const collectorNumbers = [...new Set(visibleItems
      .map((item) => item.collectorNo == null ? null : Number(item.collectorNo))
      .filter((value): value is number => value !== null && Number.isSafeInteger(value) && value > 0))];
    const receiptCustomerCodes = [...new Set(visibleItems
      .filter((item) => item.kind === 'receipt')
      .map((item) => String(item.platformCustomerCode ?? '').trim())
      .filter(Boolean))];
    const requestSerials = [...new Set(visibleItems
      .map((item) => String(item.requestSerial ?? '').trim())
      .filter(Boolean))];
    type MappedCollector = {
      id: string;
      active: boolean;
      oracleCollectorNo: number | null;
      user: { fullName: string };
    };
    let platformCollectors: Array<Pick<MappedCollector, 'id' | 'oracleCollectorNo' | 'user'>> = [];
    let receiptCustomers: Array<{
      externalCustomerCode: string | null;
      assignments: Array<{ collector: MappedCollector }>;
    }> = [];
    let requestCreators: Array<{
      entityId: string | null;
      user: { collector: MappedCollector | null } | null;
    }> = [];
    if (this.prisma && actor) {
      [platformCollectors, receiptCustomers, requestCreators] = await Promise.all([
        collectorNumbers.length > 0 ? this.prisma.collector.findMany({
        where: {
          oracleCollectorNo: { in: collectorNumbers },
          user: { organizationId: actor.organizationId },
        },
        select: { id: true, oracleCollectorNo: true, user: { select: { fullName: true } } },
        }) : [],
        receiptCustomerCodes.length > 0 ? this.prisma.customer.findMany({
        where: {
          organizationId: actor.organizationId,
          externalCustomerCode: { in: receiptCustomerCodes },
        },
        select: {
          externalCustomerCode: true,
          assignments: {
            where: { effectiveTo: null }, orderBy: { effectiveFrom: 'desc' }, take: 1,
            select: {
              collector: {
                select: { id: true, active: true, oracleCollectorNo: true, user: { select: { fullName: true } } },
              },
            },
          },
        },
        }) : [],
        requestSerials.length > 0 ? this.prisma.auditLog.findMany({
          where: {
            action: 'oracle_test_request_created',
            entityId: { in: requestSerials },
            user: { organizationId: actor.organizationId },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            entityId: true,
            user: {
              select: {
                collector: {
                  select: { id: true, active: true, oracleCollectorNo: true, user: { select: { fullName: true } } },
                },
              },
            },
          },
        }) : [],
      ]);
    }
    const collectorByNumber = new Map(platformCollectors.map((collector) => [
      String(collector.oracleCollectorNo), collector,
    ]));
    const assignedCollectorByCustomerCode = new Map(receiptCustomers.map((customer) => [
      customer.externalCustomerCode, customer.assignments[0]?.collector,
    ]));
    const creatorCollectorByRequestSerial = new Map<string, MappedCollector>();
    for (const entry of requestCreators) {
      if (entry.entityId && entry.user?.collector && !creatorCollectorByRequestSerial.has(entry.entityId)) {
        creatorCollectorByRequestSerial.set(entry.entityId, entry.user.collector);
      }
    }
    const receiptAudits = new Map(visibleItems.map(item => [item, resolveReceiptAudit(item, durableAuditRows)]));
    const receiptAuditIds = [...receiptAudits.values()].filter(Boolean).map(row => row!.id);
    const legacyKeys = visibleItems.filter(item => ['receipt', 'payment'].includes(String(item.kind)))
      .map(item => `oracle_request:${item.kind}:${item.requestNo}`);
    const attachments = receiptAuditIds.length && this.prisma && actor ? await this.prisma.attachment.findMany({
      where: { OR: [
        { entityTable: { in: ['oracle_request:receipt:audit', 'oracle_request:payment:audit'] }, entityId: { in: receiptAuditIds } },
        { entityTable: { in: legacyKeys } },
      ], uploader: { organizationId: actor.organizationId } },
      select: { id: true, entityId: true, entityTable: true, fileName: true, uploadedAt: true, uploadedBy: true },
      orderBy: { uploadedAt: 'desc' },
    }) : [];
    const legacyAttachments = attachments.filter(a => !a.entityTable.endsWith(':audit'));
    const notices = legacyAttachments.length && this.prisma && actor ? await this.prisma.notification.findMany({
      where: { kind: 'receipt_uploaded', user: { organizationId: actor.organizationId },
        OR: legacyAttachments.map(a => ({ payload: { path: ['attachmentId'], equals: a.id } })),
      }, select: { payload: true },
    }) : [];
    const provenAttachments = attachments.flatMap(attachment => {
      if (attachment.entityTable.endsWith(':audit')) {
        const audit = durableAuditRows.find(row => row.id === attachment.entityId && row.userId === attachment.uploadedBy);
        return audit ? [attachment] : [];
      }
      const references = new Set(notices.flatMap(notice => {
        const payload = notice.payload as Record<string, unknown> | null;
        return payload?.attachmentId === attachment.id && typeof payload.externalReference === 'string'
          && payload.externalReference.trim() ? [payload.externalReference.trim()] : [];
      }));
      if (references.size !== 1) return [];
      const [, kind, requestNo] = attachment.entityTable.split(':');
      const audit = resolveReceiptAudit({ kind, requestNo, externalReference: [...references][0] },
        durableAuditRows.filter(row => row.userId === attachment.uploadedBy));
      return audit ? [{ ...attachment, entityId: audit.id }] : [];
    });
    const attachmentByKey = latestReceiptByAudit(provenAttachments);
    const finalReceipts = this.prisma && actor && permissions.includes('oracle_test_requests.receipt.read')
      && this.prisma.oracleMovementSyncRun
      ? await oracleReceiptActivity(this.prisma,actor) : [];
    const receiptProofKeys = [...new Set(durableAuditRows.flatMap(row => {
      const request = durableOracleRequest(row);
      return request?.kind === 'receipt' ? [request.requestSerial,request.referenceNo].filter((value): value is string => Boolean(value)) : [];
    }))];
    const localReceiptProofs = this.prisma && actor && permissions.includes('oracle_test_requests.receipt.read')
      && receiptProofKeys.length && this.prisma.collection?.findMany
      ? await this.prisma.collection.findMany({
        where: { status: 'recorded', customer: { organizationId: actor.organizationId },
          ...(permissions.includes('customers.read_all') ? {} : { collector: { userId: actor.id } }),
          OR: [{ referenceNumber: { in: receiptProofKeys } },{ receiptNumber: { in: receiptProofKeys } }] },
        select: { id: true, customerId: true, currencyCode: true, amount: true, collectedAt: true, status: true,
          referenceNumber: true, receiptNumber: true, customer: { select: { externalCustomerCode: true } } },
      }) : [];
    const reconciledRequests = reconcileReceiptRequests(durableAuditRows,[...finalReceipts,...recordedLocalReceiptFinals(localReceiptProofs)],liveItems as Record<string,unknown>[]);
    const reconciliationBySerial = new Map(reconciledRequests.map(request=>[request.requestSerial,request]));
    return {
      mode: 'SELECT_ONLY', oracleWrite: 'NONE',
      schemas: results.map((result) => result.schema).filter(Boolean),
      partial: warnings.length > 0,
      warnings,
      items: visibleItems.map((item) => {
        const requestAudit = receiptAudits.get(item);
        const attachment = requestAudit ? attachmentByKey.get(requestAudit.id) : undefined;
        const assignedCollector = item.kind === 'receipt'
          ? assignedCollectorByCustomerCode.get(String(item.platformCustomerCode ?? '')) : null;
        const creatorCollector = creatorCollectorByRequestSerial.get(String(item.requestSerial ?? ''));
        const fallbackCollector = assignedCollector?.active ? assignedCollector
          : creatorCollector?.active ? creatorCollector : null;
        const collectorNo = item.collectorNo ?? fallbackCollector?.oracleCollectorNo ?? null;
        const mappedCollector = collectorNo == null ? null : collectorByNumber.get(String(collectorNo));
        const collectorName = mappedCollector?.user.fullName ?? fallbackCollector?.user.fullName ?? null;
        const collectorId = mappedCollector?.id ?? fallbackCollector?.id ?? null;
        const enriched = collectorName ? {
          ...item, collectorNo: String(collectorNo), collectorName, collectorId,
        } : item;
        const reconciliation = item.kind==='receipt' ? reconciliationBySerial.get(String(item.requestSerial??'')) : null;
        const linked = reconciliation ? { ...enriched, finalReceiptId:reconciliation.finalReceiptId,
          matchedBy:reconciliation.matchedBy,statusVerified:reconciliation.statusVerified,
          status:reconciliation.status,statusLabel:reconciliation.statusLabel } : enriched;
        return attachment ? { ...linked, attachment: { ...attachment, previewPath: `/mobile/receipts/${attachment.id}` } } : linked;
      }),
    };
  }
  async catalog(purpose: string, actor?: AuthUser) {
    if (!['receipt', 'payment'].includes(purpose)) throw new BadRequestException('نوع السند غير صالح');
    const result = await this.readCall(`/requests/catalog?schema=${this.readSchema}&purpose=${purpose}&oracleUserId=1&branchNo=1`);
    const parties = result?.parties as Record<string, unknown> | undefined;
    const customers = parties?.customers;
    if (!Array.isArray(customers)) return result;

    if (result?.schema === 'IAS20261' && this.prisma && actor) {
      const externalCodes = customers
        .map((value) => String((value as Record<string, unknown>).code ?? '').trim())
        .filter(Boolean);
      const platformCustomers = externalCodes.length === 0 ? [] : await this.prisma.customer.findMany({
        where: {
          organizationId: actor.organizationId,
          externalCustomerCode: { in: externalCodes },
        },
        select: {
          externalCustomerCode: true,
          assignments: {
            where: { effectiveTo: null },
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
            select: {
              collector: {
                select: {
                  active: true,
                  oracleCollectorNo: true,
                  user: { select: { fullName: true } },
                },
              },
            },
          },
        },
      });
      const platformCollectorByCustomerCode = new Map(platformCustomers.map((customer) => [
        customer.externalCustomerCode,
        customer.assignments[0]?.collector,
      ]));
      const oracleCollectors = Array.isArray(result.collectors)
        ? result.collectors as Array<Record<string, unknown>> : [];
      const oracleCollectorByCode = new Map(oracleCollectors.map((collector) => [String(collector.code), collector]));

      return {
        ...result,
        parties: {
          ...parties,
          customers: customers.map((value) => {
            const customer = value as Record<string, unknown>;
            const mapped = platformCollectorByCustomerCode.get(String(customer.code ?? ''));
            if (!mapped?.active || mapped.oracleCollectorNo == null) return customer;
            const code = String(mapped.oracleCollectorNo);
            return {
              ...customer,
              assignedCollector: oracleCollectorByCode.get(code) ?? {
                code,
                nameAr: mapped.user.fullName,
                nameEn: null,
                accountCode: null,
                analyticalAccountCode: null,
                analyticalType: null,
                commissionPercent: null,
              },
            };
          }),
        },
      };
    }

    if (result?.schema !== 'IAS20191') return result;
    return {
      ...result,
      parties: {
        ...parties,
        customers: customers.map((value) => {
          const customer = value as Record<string, unknown>;
          const linkedAccounts = customer.linkedAccounts;
          if (Array.isArray(linkedAccounts) && linkedAccounts.length > 0) return customer;
          const code = String(customer.code ?? '');
          const nameAr = typeof customer.nameAr === 'string' ? customer.nameAr : code;
          return {
            ...customer,
            linkedAccounts: [{
              accountCode: '112101001',
              accountName: 'العملاء',
              analyticalAccountCode: code,
              analyticalAccountName: nameAr,
              analyticalType: 3,
              currencyCodes: [],
            }],
          };
        }),
      },
    };
  }
  async inventoryCount(input: { documentNo: unknown; inventoryType: unknown; branchNo: unknown; branchYear: unknown }) {
    const params = this.inventoryCountParams(input);
    const query = new URLSearchParams({
      schema: 'IAS20261', inventoryType: String(params.inventoryType), branchNo: String(params.branchNo),
      branchYear: String(params.branchYear), oracleUserId: '1',
    });
    return this.readCall(`/inventory/counts/${params.documentNo}?${query.toString()}`);
  }
  async inventoryCountDryRun(input: { documentNo: unknown; inventoryType: unknown; branchNo: unknown; branchYear: unknown }) {
    const result = await this.inventoryCount(input) as Record<string, unknown> | null;
    const issues: Array<{ severity: 'error' | 'warning'; code: string; message: string }> = [];
    const document = result?.document as Record<string, unknown> | null | undefined;
    const inventoryType = result?.inventoryType as Record<string, unknown> | null | undefined;
    const lines = Array.isArray(result?.lines) ? result.lines as Array<Record<string, unknown>> : [];
    if (!document) issues.push({ severity: 'error', code: 'DOCUMENT_NOT_FOUND', message: 'مستند الجرد غير موجود في IAS20261' });
    if (!inventoryType) issues.push({ severity: 'error', code: 'INVENTORY_TYPE_NOT_FOUND', message: 'نوع الجرد غير موجود في IAS20261' });
    else if (inventoryType.viewAllowed !== true) {
      issues.push({ severity: 'error', code: 'ORACLE_VIEW_NOT_ALLOWED', message: 'المستخدم Oracle رقم 1 لا يملك صلاحية عرض نوع الجرد' });
    }
    if (document && lines.length === 0) {
      issues.push({ severity: 'error', code: 'NO_LINES', message: 'مستند الجرد لا يحتوي على أصناف' });
    }
    if (document?.processed === true || document?.externalPost === true || lines.some((line) => line.processedAdjustment === true)) {
      issues.push({ severity: 'warning', code: 'ALREADY_PROCESSED', message: 'توجد علامة معالجة أو ترحيل تشخيصية؛ لم تُجرَ أي معالجة جديدة' });
    }
    if (lines.some((line) => line.conversionProven !== true)) {
      issues.push({
        severity: 'warning', code: 'UNPROVEN_UNIT_CONVERSION',
        message: 'لم يُحسب فرق بعض الأسطر لأن قاعدة التحويل متعددة الوحدات لم تُثبت بعد',
      });
    }
    return {
      ...result, mode: 'DRY_RUN', oracleWrite: 'NONE',
      valid: !issues.some((issue) => issue.severity === 'error'), issues,
    };
  }
  async inventoryCountCreateDryRun(payload: unknown) {
    const input = payload as {
      inventoryType?: unknown;
      warehouseCode?: unknown;
      description?: unknown;
      lines?: Array<{
        itemCode?: unknown;
        unitCode?: unknown;
        countedQuantity?: unknown;
      }>;
    } | null;
    const inventoryType = Number(input?.inventoryType);
    const warehouseCode = Number(input?.warehouseCode);
    const description = typeof input?.description === 'string' ? input.description.trim() : '';
    const lines = Array.isArray(input?.lines) ? input.lines : [];
    if (![1, 2].includes(inventoryType)) throw new BadRequestException('نوع الجرد غير صالح');
    if (!Number.isSafeInteger(warehouseCode) || warehouseCode <= 0) throw new BadRequestException('المخزن الافتراضي غير صالح');
    if (!description) throw new BadRequestException('بيان الجرد مطلوب');
    if (lines.length === 0) throw new BadRequestException('أضف صنفًا واحدًا على الأقل');
    if (this.readSchema !== 'IAS20261') throw new ServiceUnavailableException('فحص الجرد التشغيلي مقيد بقراءة IAS20261 فقط');
    const type = inventoryType === 2
      ? { code: '2', nameAr: 'جرد من تطبيق البناء الراقي' }
      : { code: '1', nameAr: 'جرد يدوي' };

    const uniqueLines = new Set<string>();
    const preparedLines = await Promise.all(lines.map(async (line, index) => {
      const itemCode = typeof line.itemCode === 'string' ? line.itemCode.trim() : '';
      const unitCode = typeof line.unitCode === 'string' ? line.unitCode.trim() : '';
      const countedQuantity = Number(line.countedQuantity);
      if (!itemCode || !unitCode || !Number.isFinite(countedQuantity) || countedQuantity < 0) {
        throw new BadRequestException(`بيانات السطر ${index + 1} غير صالحة`);
      }
      const uniqueKey = `${itemCode}|${unitCode}`;
      if (uniqueLines.has(uniqueKey)) throw new BadRequestException(`الصنف والوحدة مكرران في السطر ${index + 1}`);
      uniqueLines.add(uniqueKey);

      const stockQuery = new URLSearchParams({
        schema: this.readSchema, itemCode, unitCode, warehouseCode: String(warehouseCode),
      });
      const [stock, item] = await Promise.all([
        this.readCall(`/inventory/stock?${stockQuery.toString()}`) as Promise<Record<string, unknown>>,
        this.readCall(`/inventory/items/${encodeURIComponent(itemCode)}?schema=${this.readSchema}`) as Promise<Record<string, unknown>>,
      ]);
      if (stock.warehouseExists !== true) throw new BadRequestException(`المخزن غير موجود في السطر ${index + 1}`);
      if (stock.itemExists !== true) throw new BadRequestException(`الصنف غير موجود في السطر ${index + 1}`);
      if (stock.unitExists !== true) throw new BadRequestException(`الوحدة غير معتمدة للصنف في السطر ${index + 1}`);
      const packageSize = Number(stock.packageSize);
      const availableQuantity = Number(stock.availableQuantity ?? 0);
      return {
        lineNo: index + 1,
        itemCode,
        itemNameAr: typeof item.nameAr === 'string' ? item.nameAr : itemCode,
        itemNameEn: typeof item.nameEn === 'string' ? item.nameEn : null,
        unitCode,
        warehouseCode: String(warehouseCode),
        countedQuantity,
        packageSize,
        packageQuantity: countedQuantity * packageSize,
        availableQuantity,
        differenceQuantity: countedQuantity - availableQuantity,
      };
    }));

    const localResult = {
      valid: true,
      mode: 'DRY_RUN',
      oracleWrite: 'NONE',
      schema: this.readSchema,
      referenceSchema: this.readSchema,
      draftSchema: this.inventoryWriteSchema || null,
      saveAllowed: false,
      issues: [] as Array<{ severity: string; code?: string; message: string }>,
      inventoryType: { code: String(type.code), nameAr: String(type.nameAr ?? type.code) },
      warehouseCode: String(warehouseCode),
      description,
      lines: preparedLines,
    };
    if (!this.inventoryWriteEnabled || !this.inventoryWriteBaseUrl || !this.inventoryWriteApiKey
      || this.inventoryWriteSchema !== 'IAS20261') {
      return {
        ...localResult,
        saveBlockedReason: 'نجح الفحص من IAS20261، لكن بوابة حفظ مسودة الجرد المحدودة غير مفعلة.',
      };
    }
    const writerResult = await this.inventoryWriteCall('/inventory/counts/dry-run', input);
    const writerIssues = Array.isArray(writerResult?.issues)
      ? writerResult.issues as Array<{ severity: string; code?: string; message: string }> : [];
    const saveAllowed = writerResult?.valid !== false && writerResult?.saveAllowed !== false;
    return {
      ...localResult,
      ...writerResult,
      valid: saveAllowed,
      saveAllowed,
      issues: writerIssues,
      ...(saveAllowed ? {} : { saveBlockedReason: 'فحص بوابة الجرد IAS20261 يحتاج معالجة قبل الحفظ.' }),
    };
  }
  async inventoryCountCreate(payload: unknown) {
    const created = await this.inventoryWriteCall('/inventory/counts', payload);
    const documentNo = String(created?.documentNo ?? '');
    const documentSerial = String(created?.documentSerial ?? '');
    const inventoryType = Number(created?.inventoryType);
    if (!/^\d{1,12}$/.test(documentNo) || !/^\d{1,30}$/.test(documentSerial)
      || ![1, 2].includes(inventoryType)) {
      throw new ServiceUnavailableException('أعادت بوابة الجرد أرقام مستند غير صالحة');
    }
    try {
      const readback = await this.inventoryCount({
        documentNo: Number(documentNo), inventoryType, branchNo: 1, branchYear: 2026,
      }) as Record<string, unknown>;
      const document = readback?.document as Record<string, unknown> | null | undefined;
      const lines = Array.isArray(readback?.lines) ? readback.lines : [];
      if (!document || String(document.number ?? '') !== documentNo || lines.length < 1
        || document.processed === true || document.externalPost === true) {
        return {
          ...created,
          verified: false,
          readbackPending: true,
          readbackWarning: 'تم حفظ مسودة الجرد، لكن تعذر مطابقتها من IAS20261 مؤقتًا. لا تعِد الحفظ؛ حدّث قائمة الطلبات للتحقق من حالتها.',
        };
      }
      return { ...created, verified: true, readbackPending: false, readback };
    } catch {
      return {
        ...created,
        verified: false,
        readbackPending: true,
        readbackWarning: 'تم حفظ مسودة الجرد، لكن قراءة حالتها من IAS20261 غير متاحة مؤقتًا. لا تعِد الحفظ؛ حدّث قائمة الطلبات للتحقق من حالتها.',
      };
    }
  }
  async purchaseDryRun(payload: unknown) {
    const input = payload as {
      warehouseCode?: unknown;
      requestSide?: unknown;
      notes?: unknown;
      lines?: Array<{ itemCode?: unknown; unitCode?: unknown; quantity?: unknown }>;
    } | null;
    const warehouseCode = typeof input?.warehouseCode === 'string' ? input.warehouseCode.trim() : String(input?.warehouseCode ?? '').trim();
    const notes = typeof input?.notes === 'string' ? input.notes.trim() : '';
    const requestSide = typeof input?.requestSide === 'string' ? input.requestSide.trim() : '';
    const lines = Array.isArray(input?.lines) ? input.lines : [];
    if (!warehouseCode) throw new BadRequestException('اختر المستودع من كتالوج IAS20261');
    if (!requestSide) throw new BadRequestException('جهة طلب الشراء مطلوبة');
    if (lines.length === 0) throw new BadRequestException('أضف صنفًا واحدًا على الأقل');
    if (this.readSchema !== 'IAS20261') throw new ServiceUnavailableException('فحص طلب الشراء مقيد بقراءة IAS20261 فقط');

    const uniqueLines = new Set<string>();
    const preparedLines = await Promise.all(lines.map(async (line, index) => {
      const itemCode = typeof line.itemCode === 'string' ? line.itemCode.trim() : '';
      const unitCode = typeof line.unitCode === 'string' ? line.unitCode.trim() : '';
      const quantity = Number(line.quantity);
      if (!itemCode || !unitCode || !Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException(`بيانات الصنف ${index + 1} غير صالحة`);
      }
      const uniqueKey = `${itemCode}|${unitCode}`;
      if (uniqueLines.has(uniqueKey)) throw new BadRequestException(`الصنف والوحدة مكرران في السطر ${index + 1}`);
      uniqueLines.add(uniqueKey);
      const stockQuery = new URLSearchParams({
        schema: this.readSchema, itemCode, unitCode, warehouseCode,
      });
      const [stock, item] = await Promise.all([
        this.readCall(`/inventory/stock?${stockQuery.toString()}`) as Promise<Record<string, unknown>>,
        this.readCall(`/inventory/items/${encodeURIComponent(itemCode)}?schema=${this.readSchema}`) as Promise<Record<string, unknown>>,
      ]);
      if (stock.warehouseExists !== true) throw new BadRequestException(`المستودع غير موجود في IAS20261 للسطر ${index + 1}`);
      if (stock.itemExists !== true) throw new BadRequestException(`الصنف غير موجود في IAS20261 للسطر ${index + 1}`);
      if (stock.unitExists !== true) throw new BadRequestException(`الوحدة غير معتمدة للصنف في السطر ${index + 1}`);
      return {
        lineNo: index + 1,
        itemCode,
        itemNameAr: typeof item.nameAr === 'string' ? item.nameAr : itemCode,
        itemNameEn: typeof item.nameEn === 'string' ? item.nameEn : null,
        unitCode,
        warehouseCode,
        quantity,
        packageSize: Number(stock.packageSize),
        availableQuantity: Number(stock.availableQuantity ?? 0),
      };
    }));

    const readResult = {
      valid: true,
      mode: 'DRY_RUN',
      oracleWrite: 'NONE',
      schema: this.readSchema,
      referenceSchema: this.readSchema,
      draftSchema: this.purchaseWriteSchema || null,
      saveAllowed: false,
      warehouseCode,
      requestSide,
      notes,
      lines: preparedLines,
    };
    if (!this.purchaseWriteEnabled) {
      return {
        ...readResult,
        saveBlockedReason: 'نجح فحص طلب الشراء من IAS20261، لكن بوابة الكتابة المستقلة لم تُفعّل بعد.',
        issues: [{
          severity: 'warning', code: 'IAS20261_PURCHASE_WRITER_DISABLED',
          message: 'لم تُرسل أي بيانات؛ فعّل بوابة طلب الشراء IAS20261 بعد منحها الصلاحيات المحدودة.',
        }],
      };
    }
    const writerResult = await this.purchaseWriteCall('/purchasing/requests/dry-run', payload);
    return {
      ...readResult,
      ...writerResult,
      lines: preparedLines,
      schema: this.readSchema,
      referenceSchema: this.readSchema,
      draftSchema: this.purchaseWriteSchema,
      saveAllowed: writerResult?.valid === true && writerResult?.schema === 'IAS20261',
      issues: [],
    };
  }
  async purchaseCreate(payload: unknown) {
    const created = await this.purchaseWriteCall('/purchasing/requests', payload);
    const requestSerial = typeof created?.requestSerial === 'string' ? created.requestSerial : '';
    if (!/^\d{1,30}$/.test(requestSerial)) {
      throw new ServiceUnavailableException('أعادت بوابة الكتابة مسلسل طلب غير صالح');
    }
    const readback = await this.readCall(`/requests/purchases/${requestSerial}?schema=IAS20261`) as Record<string, unknown>;
    const request = readback?.request as Record<string, unknown> | null | undefined;
    const lines = Array.isArray(readback?.lines) ? readback.lines : [];
    const approvals = Array.isArray(readback?.approvals) ? readback.approvals : [];
    if (!request || String(request.REQUEST_SERIAL ?? request.requestSerial ?? '') !== requestSerial || lines.length === 0
      || !approvals.some((approval) => Number((approval as Record<string, unknown>).DOCUMENT_TYPE
        ?? (approval as Record<string, unknown>).documentType) === 40)) {
      throw new ServiceUnavailableException('تمت الكتابة لكن تعذر مطابقة طلب الشراء من IAS20261؛ أعد المحاولة بالمرجع نفسه');
    }
    return { ...created, verified: true, readback };
  }
  async voucherDryRun(payload: unknown, actor?: AuthUser) {
    const input = payload as {
      kind?: unknown; paymentMethod?: unknown; currencyCode?: unknown; amount?: unknown;
      cashOrBankNo?: unknown;
      lines?: Array<Record<string, unknown>>;
    } | null;
    const kind = input?.kind;
    const paymentMethod = input?.paymentMethod;
    const documentCurrencyCode = typeof input?.currencyCode === 'string' ? input.currencyCode.trim() : '';
    const documentAmount = Number(input?.amount);
    const inputLines = Array.isArray(input?.lines) ? input.lines : [];
    if (!['receipt', 'payment'].includes(String(kind))) throw new BadRequestException('نوع السند غير صالح');
    if (kind === 'receipt') await this.receiptFollowupPlan(payload, actor);
    if (!['cash', 'bank_transfer'].includes(String(paymentMethod))) throw new BadRequestException('طريقة الدفع غير صالحة');
    if (!documentCurrencyCode || !Number.isFinite(documentAmount) || documentAmount <= 0) {
      throw new BadRequestException('عملة ومبلغ الصندوق أو البنك غير صالحين');
    }
    if (inputLines.length === 0 || inputLines.length > 20) throw new BadRequestException('أضف طرف سند صالحًا واحدًا على الأقل');
    if (this.readSchema !== 'IAS20261') throw new ServiceUnavailableException('فحص عملات السندات مقيد بقراءة IAS20261 فقط');

    const [currencyCatalog, requestCatalog] = await Promise.all([
      this.currencies() as Promise<{ currencies?: Array<Record<string, unknown>> }>,
      this.catalog(String(kind)) as Promise<Record<string, unknown>>,
    ]);
    const currencies = Array.isArray(currencyCatalog.currencies) ? currencyCatalog.currencies : [];
    const byCode = new Map(currencies.map((currency) => [String(currency.code), currency]));
    const localCurrencies = currencies.filter((currency) => currency.local === true);
    if (localCurrencies.length !== 1) throw new ServiceUnavailableException('يجب تحديد عملة محلية واحدة في IAS20261');
    const localCurrency = String(localCurrencies[0].code);
    const resolve = (code: string) => {
      const currency = byCode.get(code);
      const rate = Number(currency?.rate);
      const fractionDigits = Number(currency?.fractionDigits ?? 2);
      if (!currency || !Number.isFinite(rate) || rate <= 0 || !Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 6) {
        throw new BadRequestException(`عملة السند غير صالحة: ${code}`);
      }
      return {
        code, rate, fractionDigits,
        local: currency.local === true,
        nameAr: typeof currency.nameAr === 'string' ? currency.nameAr : code,
        rateUpdatedAt: typeof currency.rateUpdatedAt === 'string' ? currency.rateUpdatedAt : null,
      };
    };
    const toLocal = (amount: number, currency: ReturnType<typeof resolve>) => {
      if (currency.local === true) return amount;
      const factor = 10 ** currency.fractionDigits;
      return Math.round((amount * currency.rate + Number.EPSILON) * factor) / factor;
    };

    const issues: Array<{ severity: 'error' | 'warning'; code: string; message: string }> = [];
    const locationRows = paymentMethod === 'cash'
      ? requestCatalog.cashboxes as Array<Record<string, unknown>> | undefined
      : requestCatalog.banks as Array<Record<string, unknown>> | undefined;
    const location = (Array.isArray(locationRows) ? locationRows : [])
      .find((row) => String(row.code) === String(input?.cashOrBankNo ?? ''));
    const locationCurrencies = Array.isArray(location?.currencyCodes)
      ? location.currencyCodes.map(String)
      : [];
    if (!location) issues.push({
      severity: 'error', code: 'CASH_OR_BANK_NOT_FOUND',
      message: paymentMethod === 'cash' ? 'الصندوق المحدد غير موجود أو غير مسموح' : 'البنك المحدد غير موجود أو غير مسموح',
    });
    else if (!locationCurrencies.includes(documentCurrencyCode)) issues.push({
      severity: 'error', code: 'CASH_OR_BANK_CURRENCY_NOT_ALLOWED',
      message: `${paymentMethod === 'cash' ? 'الصندوق' : 'البنك'} المحدد غير مفعّل بعملة ${documentCurrencyCode} في IAS20261`,
    });

    const parties = requestCatalog.parties as Record<string, unknown> | undefined;
    const accountLinks = Object.values(parties ?? {}).flatMap((rows) =>
      (Array.isArray(rows) ? rows : []).flatMap((party) => {
        const links = (party as Record<string, unknown>).linkedAccounts;
        return Array.isArray(links) ? links as Array<Record<string, unknown>> : [];
      }));
    const documentCurrency = resolve(documentCurrencyCode);
    const localAmount = toLocal(documentAmount, documentCurrency);
    const lines = inputLines.map((line, index) => {
      const currencyCode = typeof line.currencyCode === 'string' ? line.currencyCode.trim() : '';
      const amount = Number(line.amount);
      if (!currencyCode || !Number.isFinite(amount) || amount <= 0) throw new BadRequestException(`عملة ومبلغ طرف السند ${index + 1} غير صالحين`);
      const currency = resolve(currencyCode);
      const linkedAccount = accountLinks.find((link) =>
        String(link.accountCode) === String(line.accountCode ?? '')
        && String(link.analyticalAccountCode) === String(line.analyticalAccountCode ?? '')
        && Number(link.analyticalType) === Number(line.analyticalType));
      const allowedCurrencies = Array.isArray(linkedAccount?.currencyCodes)
        ? linkedAccount.currencyCodes.map(String)
        : [];
      if (!linkedAccount) issues.push({
        severity: 'error', code: 'PARTY_ACCOUNT_NOT_LINKED',
        message: `الحساب المرتبط لطرف السند ${index + 1} غير مؤكد في IAS20261`,
      });
      else if (!allowedCurrencies.includes(currencyCode)) issues.push({
        severity: 'error', code: 'PARTY_ACCOUNT_CURRENCY_NOT_ALLOWED',
        message: `حساب طرف السند ${index + 1} غير مفعّل بعملة ${currencyCode} في IAS20261`,
      });
      return {
        ...line, lineNo: index + 1, currencyCode, amount,
        currencyName: currency.nameAr, exchangeRate: currency.rate,
        rateSource: 'EX_RATE', rateUpdatedAt: currency.rateUpdatedAt ?? null,
        localAmount: toLocal(amount, currency),
      };
    });
    const counterpartyLocalAmount = lines.reduce((sum, line) => sum + line.localAmount, 0);
    const localBalance = Math.round((localAmount - counterpartyLocalAmount + Number.EPSILON) * 100) / 100;
    if (localBalance !== 0) issues.push({
      severity: 'error', code: 'UNBALANCED_LOCAL_AMOUNT',
      message: 'قيمة الصندوق أو البنك لا تساوي مجموع أطراف السند بعد التحويل بسعر صرف النظام',
    });
    const localResult = {
      valid: !issues.some((issue) => issue.severity === 'error'), mode: 'DRY_RUN', oracleWrite: 'NONE', schema: this.readSchema,
      referenceSchema: this.readSchema,
      draftSchema: kind === 'receipt' ? this.receiptWriteSchema || null : this.paymentWriteSchema || null,
      kind, paymentMethod, documentAmount, documentCurrency: documentCurrency.code,
      documentCurrencyName: documentCurrency.nameAr, exchangeRate: documentCurrency.rate,
      rateSource: 'EX_RATE', rateUpdatedAt: documentCurrency.rateUpdatedAt ?? null,
      localAmount, counterpartyLocalAmount, localBalance, localCurrency, lines, issues,
    };
    if (!localResult.valid) return { ...localResult, saveAllowed: false };
    if (kind === 'payment') {
      if (!this.paymentWriteEnabled || !this.paymentWriteBaseUrl || !this.paymentWriteApiKey
        || this.paymentWriteSchema !== 'IAS20261') {
        const paymentIssue = {
          severity: 'warning' as const, code: 'IAS20261_PAYMENT_WRITER_DISABLED',
          message: 'نجح الفحص الأولي، لكن بوابة كتابة سند الصرف المقيدة IAS20261 غير مفعلة.',
        };
        return {
          ...localResult, issues: [...issues, paymentIssue], saveAllowed: false,
          saveBlockedReason: paymentIssue.message,
        };
      }
      const writerResult = await this.paymentWriteCall('/accounting/payments/dry-run', await this.voucherWriterPayload(payload, actor));
      const writerIssues = Array.isArray(writerResult?.issues)
        ? writerResult.issues as Array<{ severity: 'error' | 'warning'; code: string; message: string }>
        : [];
      const saveAllowed = writerResult?.valid === true && writerResult?.schema === 'IAS20261'
        && !writerIssues.some((issue) => issue.severity === 'error');
      return {
        ...localResult,
        ...writerResult,
        referenceSchema: this.readSchema,
        draftSchema: 'IAS20261',
        validationSchema: 'IAS20261',
        localCurrency,
        valid: localResult.valid && saveAllowed,
        issues: [...issues, ...writerIssues],
        saveAllowed,
        ...(saveAllowed ? {} : { saveBlockedReason: 'فحص بوابة سند الصرف IAS20261 يحتاج معالجة قبل الحفظ.' }),
      };
    }
    if (!this.receiptWriteEnabled || !this.receiptWriteBaseUrl || !this.receiptWriteApiKey
      || this.receiptWriteSchema !== 'IAS20261') {
      const receiptIssue = {
        severity: 'warning' as const, code: 'IAS20261_RECEIPT_WRITER_DISABLED',
        message: 'نجح فحص سند القبض من IAS20261، لكن بوابة الكتابة المقيدة لم تُفعّل بعد.',
      };
      return {
        ...localResult, issues: [...issues, receiptIssue], saveAllowed: false,
        saveBlockedReason: receiptIssue.message,
      };
    }
    const writerResult = await this.receiptWriteCall('/accounting/receipts/dry-run', await this.voucherWriterPayload(payload, actor));
    const writerIssues = Array.isArray(writerResult?.issues)
      ? writerResult.issues as Array<{ severity: 'error' | 'warning'; code: string; message: string }>
      : [];
    const saveAllowed = writerResult?.valid === true && writerResult?.schema === 'IAS20261'
      && !writerIssues.some((issue) => issue.severity === 'error');
    return {
      ...localResult,
      ...writerResult,
      referenceSchema: this.readSchema,
      draftSchema: 'IAS20261',
      localCurrency,
      issues: [...issues, ...writerIssues],
      saveAllowed,
      ...(saveAllowed ? {} : { saveBlockedReason: 'فحص بوابة سند القبض IAS20261 يحتاج معالجة قبل الحفظ.' }),
    };
  }
  async voucherCreate(payload: unknown, actor?: AuthUser) {
    const kind = String((payload as { kind?: unknown } | null)?.kind ?? '');
    if (!['receipt', 'payment'].includes(kind)) {
      throw new BadRequestException('نوع السند غير صالح');
    }
    if (kind === 'receipt') this.assertReceiptWriter();
    const followupPlan = kind === 'receipt' ? await this.receiptFollowupPlan(payload, actor) : null;
    const writerPayload = await this.voucherWriterPayload(payload, actor);
    const created = kind === 'receipt'
      ? await this.receiptWriteCall('/accounting/receipts', writerPayload)
      : await this.paymentWriteCall('/accounting/payments', writerPayload);
    const requestSerial = String(created?.requestSerial ?? '');
    if (!/^\d{1,30}$/.test(requestSerial)) {
      throw new ServiceUnavailableException(`أعادت بوابة سند ${kind === 'receipt' ? 'القبض' : 'الصرف'} رقمًا تسلسليًا غير صالح`);
    }
    const readback = await this.readCall(`/requests/${kind === 'receipt' ? 'receipts' : 'payments'}/${requestSerial}?schema=IAS20261`) as Record<string, unknown>;
    const request = readback?.request as Record<string, unknown> | null | undefined;
    const readbackLines = Array.isArray(readback?.lines) ? readback.lines : [];
    const approvals = Array.isArray(readback?.approvals) ? readback.approvals : [];
    if (!request || String(request.REQUEST_SERIAL ?? request.requestSerial ?? '') !== requestSerial
      || Number(request.VOUCHER_TYPE ?? request.voucherType) !== (kind === 'receipt' ? 1 : 2) || readbackLines.length === 0
      || !approvals.some((approval) => Number((approval as Record<string, unknown>).DOCUMENT_TYPE
        ?? (approval as Record<string, unknown>).documentType) === (kind === 'receipt' ? 92 : 93))) {
      throw new ServiceUnavailableException(`تمت الكتابة لكن تعذر مطابقة سند ${kind === 'receipt' ? 'القبض' : 'الصرف'} من IAS20261؛ أعد المحاولة بالمرجع نفسه`);
    }
    if (kind === 'receipt' && Number(request.COLLECTOR_NO ?? request.collectorNo) !== Number((writerPayload as Record<string, unknown>).collectorNo)) {
      throw new ConflictException(`طلب سند القبض ${String(created?.requestNo ?? '')} موجود لكن رقم المحصل فيه لا يطابق الرقم المطلوب؛ راجع الطلب الأصلي ولا تنشئ طلبًا بمرجع جديد`);
    }
    const collectionFollowup = await this.applyReceiptFollowupPlan(followupPlan, actor);
    return { ...created, ...(kind === 'receipt' ? { collectorNo: (writerPayload as Record<string, unknown>).collectorNo } : {}), verified: true, readback, collectionFollowup };
  }
  async journalDryRun(payload: unknown) {
    const input = payload as { lines?: Array<Record<string, unknown>> } | null;
    const inputLines = Array.isArray(input?.lines) ? input.lines : [];
    if (inputLines.length < 2 || inputLines.length > 100) {
      throw new BadRequestException('يجب أن يحتوي القيد على سطرين صالحين على الأقل');
    }
    if (this.readSchema !== 'IAS20261') {
      throw new ServiceUnavailableException('فحص القيد اليومي مقيد بقراءة IAS20261 فقط');
    }

    const [currencyCatalog, requestCatalog] = await Promise.all([
      this.currencies() as Promise<{ currencies?: Array<Record<string, unknown>> }>,
      this.catalog('receipt') as Promise<Record<string, unknown>>,
    ]);
    const currencies = Array.isArray(currencyCatalog.currencies) ? currencyCatalog.currencies : [];
    const byCode = new Map(currencies.map((currency) => [String(currency.code), currency]));
    const localCurrencies = currencies.filter((currency) => currency.local === true);
    if (localCurrencies.length !== 1) {
      throw new ServiceUnavailableException('يجب تحديد عملة محلية واحدة في IAS20261');
    }
    const localCurrency = String(localCurrencies[0].code);
    const parties = requestCatalog.parties as Record<string, unknown> | undefined;
    const accountLinks = Object.values(parties ?? {}).flatMap((rows) =>
      (Array.isArray(rows) ? rows : []).flatMap((party) => {
        const links = (party as Record<string, unknown>).linkedAccounts;
        return Array.isArray(links) ? links as Array<Record<string, unknown>> : [];
      }));
    const issues: Array<{ severity: 'error' | 'warning'; code: string; message: string }> = [];
    const resolveCurrency = (code: string) => {
      const currency = byCode.get(code);
      const rate = Number(currency?.rate);
      const fractionDigits = Number(currency?.fractionDigits ?? 2);
      if (!currency || !Number.isFinite(rate) || rate <= 0 || !Number.isInteger(fractionDigits)
        || fractionDigits < 0 || fractionDigits > 6) {
        throw new BadRequestException(`عملة سطر القيد غير صالحة: ${code}`);
      }
      return {
        code,
        rate,
        fractionDigits,
        local: currency.local === true,
        nameAr: typeof currency.nameAr === 'string' ? currency.nameAr : code,
      };
    };
    const toLocal = (amount: number, currency: ReturnType<typeof resolveCurrency>) => {
      if (currency.local) return amount;
      const factor = 10 ** currency.fractionDigits;
      return Math.round((amount * currency.rate + Number.EPSILON) * factor) / factor;
    };
    const lines = inputLines.map((line, index) => {
      const direction = String(line.direction ?? '');
      const currencyCode = typeof line.currencyCode === 'string' ? line.currencyCode.trim() : '';
      const amount = Number(line.amount);
      if (!['debit', 'credit'].includes(direction) || !currencyCode || !Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException(`اتجاه وعملة ومبلغ سطر القيد ${index + 1} غير صالحين`);
      }
      const currency = resolveCurrency(currencyCode);
      const linkedAccount = accountLinks.find((link) =>
        String(link.accountCode) === String(line.accountCode ?? '')
        && String(link.analyticalAccountCode) === String(line.analyticalAccountCode ?? '')
        && Number(link.analyticalType) === Number(line.analyticalType));
      const allowedCurrencies = Array.isArray(linkedAccount?.currencyCodes)
        ? linkedAccount.currencyCodes.map(String)
        : [];
      if (!linkedAccount) issues.push({
        severity: 'error', code: 'JOURNAL_ACCOUNT_NOT_LINKED',
        message: `الحساب المرتبط بسطر القيد ${index + 1} غير مؤكد في IAS20261`,
      });
      else if (!allowedCurrencies.includes(currencyCode)) issues.push({
        severity: 'error', code: 'JOURNAL_ACCOUNT_CURRENCY_NOT_ALLOWED',
        message: `حساب سطر القيد ${index + 1} غير مفعّل بعملة ${currencyCode} في IAS20261`,
      });
      const localAmount = toLocal(amount, currency);
      return {
        ...line,
        lineNo: index + 1,
        direction,
        currencyCode,
        amount,
        currencyName: currency.nameAr,
        exchangeRate: currency.rate,
        localAmount,
        signedLocalAmount: direction === 'debit' ? localAmount : -localAmount,
      };
    });
    if (!lines.some((line) => line.direction === 'debit') || !lines.some((line) => line.direction === 'credit')) {
      issues.push({ severity: 'error', code: 'JOURNAL_SIDES_REQUIRED', message: 'يجب أن يحتوي القيد على مدين ودائن' });
    }
    const localBalance = Math.round((lines.reduce((sum, line) => sum + line.signedLocalAmount, 0)
      + Number.EPSILON) * 100) / 100;
    if (localBalance !== 0) issues.push({
      severity: 'error', code: 'UNBALANCED_LOCAL_AMOUNT',
      message: 'القيد غير متوازن بالعملة المحلية حسب سعر صرف IAS20261',
    });
    const localResult = {
      valid: !issues.some((issue) => issue.severity === 'error'),
      mode: 'DRY_RUN', oracleWrite: 'NONE', schema: this.readSchema,
      referenceSchema: this.readSchema, draftSchema: this.journalWriteSchema || null,
      localCurrency, localBalance, lines, issues,
    };
    if (!localResult.valid) return { ...localResult, saveAllowed: false };
    if (!this.journalWriteEnabled || !this.journalWriteBaseUrl || !this.journalWriteApiKey
      || this.journalWriteSchema !== 'IAS20261') {
      const issue = {
        severity: 'warning' as const, code: 'IAS20261_JOURNAL_WRITER_DISABLED',
        message: 'نجح فحص القيد من IAS20261، لكن بوابة الكتابة المقيدة لم تُفعّل بعد.',
      };
      return {
        ...localResult, issues: [...issues, issue], saveAllowed: false,
        saveBlockedReason: issue.message,
      };
    }
    const writerResult = await this.journalWriteCall('/accounting/journals/dry-run', payload);
    const writerIssues = Array.isArray(writerResult?.issues)
      ? writerResult.issues as Array<{ severity: 'error' | 'warning'; code: string; message: string }>
      : [];
    const saveAllowed = writerResult?.valid === true && writerResult?.schema === 'IAS20261'
      && !writerIssues.some((issue) => issue.severity === 'error');
    return {
      ...localResult,
      ...writerResult,
      referenceSchema: this.readSchema,
      validationSchema: 'IAS20261',
      draftSchema: 'IAS20261',
      localCurrency,
      valid: localResult.valid && saveAllowed,
      issues: [...issues, ...writerIssues],
      saveAllowed,
      ...(saveAllowed ? {} : { saveBlockedReason: 'فحص بوابة القيد اليومي IAS20261 يحتاج معالجة قبل الحفظ.' }),
    };
  }

  async journalCreate(payload: unknown) {
    const created = await this.journalWriteCall('/accounting/journals', payload);
    const requestSerial = String(created?.requestSerial ?? '');
    if (!/^\d{1,30}$/.test(requestSerial)) {
      throw new ServiceUnavailableException('أعادت بوابة القيد اليومي مسلسلًا غير صالح');
    }
    const readback = await this.readCall(`/requests/journals/${requestSerial}?schema=IAS20261`) as Record<string, unknown>;
    const request = readback?.request as Record<string, unknown> | null | undefined;
    const lines = Array.isArray(readback?.lines) ? readback.lines : [];
    const approvals = Array.isArray(readback?.approvals) ? readback.approvals : [];
    if (!request || String(request.REQUEST_SERIAL ?? request.requestSerial ?? '') !== requestSerial
      || Number(request.JOURNAL_TYPE ?? request.journalType) !== 1 || lines.length < 2
      || !approvals.some((approval) => Number((approval as Record<string, unknown>).DOCUMENT_TYPE
        ?? (approval as Record<string, unknown>).documentType) === 85)) {
      throw new ServiceUnavailableException('تمت الكتابة لكن تعذر مطابقة القيد اليومي من IAS20261؛ أعد المحاولة بالمرجع نفسه');
    }
    return { ...created, verified: true, readback };
  }
}
