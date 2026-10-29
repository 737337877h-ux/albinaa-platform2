import { BadGatewayException, BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { StatementQueryDto } from './dto/statement-query.dto';

@Injectable()
export class OracleAccountStatementReader {
  private readonly logger = new Logger(OracleAccountStatementReader.name);
  constructor(private readonly config: ConfigService) {}

  async read(customer: { customerType: string | null; externalCustomerCode: string; accountNumber: string | null }, q: StatementQueryDto) {
    const base = this.config.get<string>('ORACLE_READ_API_URL')?.trim().replace(/\/$/, '');
    const key = this.config.get<string>('ORACLE_READ_API_KEY')?.trim();
    const schema = this.config.get<string>('ORACLE_READ_SCHEMA') ?? 'IAS20261';
    if (!base || !key || schema !== 'IAS20261') throw new ServiceUnavailableException('بوابة الكشف التاريخي غير مهيأة لقاعدة IAS20261');
    const kind = customer.customerType === 'advance' ? 'advance' : 'customer';
    // Advances have an independent analytical number, not the platform's synthetic customer code.
    const code = kind === 'advance' ? customer.accountNumber : customer.externalCustomerCode;
    if (!code || !/^\d{1,30}$/.test(code)) throw new BadRequestException('لا يوجد رقم Oracle موثوق لهذا الحساب');
    if (!q.fromDate || !q.toDate) throw new BadRequestException('حدد بداية ونهاية الفترة للكشف التاريخي');
    const params = new URLSearchParams({ schema, kind, code, currency: q.currency, fromDate: q.fromDate, toDate: q.toDate });
    let response: Response;
    for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch(`${base}/accounting/statement?${params}`, {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000),
      });
      break;
    } catch (error: any) {
      const timeout = ['TimeoutError', 'AbortError'].includes(error?.name);
      this.logger.warn(`Statement read attempt ${attempt + 1}: ${timeout ? 'timeout' : 'transport failure'}`);
      if (attempt === 0) continue; // GET-only retry; total transport wait stays below 45 seconds.
      throw new ServiceUnavailableException(timeout
        ? 'استغرقت قراءة الكشف وقتًا أطول من المهلة بعد إعادة المحاولة؛ حاول مجددًا أو اختر فترة أقصر'
        : 'تعذر الاتصال ببوابة قراءة الكشف بعد إعادة المحاولة؛ تحقق من البوابة والشبكة');
    }
    }
    if ([400, 422].includes(response.status)) {
      const message = response.status === 422
        ? 'تجاوزت الفترة 5000 حركة؛ اختر فترة أقصر. سيشمل الرصيد الافتتاحي الحركات السابقة.'
        : 'تحقق من العملة والفترة؛ الأرشيف المتاح من 2020 إلى 2026.';
      throw new BadRequestException(message);
    }
    if (!response.ok) throw new BadGatewayException('مصدر الكشف التاريخي غير متاح؛ لم يتم استبداله بكشف ناقص من المنصة');
    const data = await response.json();
    if (data.mode !== 'SELECT_ONLY' || data.oracleWrite !== 'NONE' || data.schema !== schema
      || data.source !== 'IAS_V_POST_DTL_YR' || !Array.isArray(data.rows) || !data.rows.length) {
      throw new BadGatewayException('لم تؤكد البوابة مصدر الكشف التاريخي');
    }
    const first = data.rows[0];
    const amount = (value: unknown) => new Prisma.Decimal(String(value ?? 0));
    const opening = amount(first.OPENING);
    const end = opening.plus(amount(first.TOTAL_DEBIT)).minus(amount(first.TOTAL_CREDIT));
    const rows = data.rows.filter((r: any) => r.RN != null);
    if (rows.length !== Number(first.TOTAL)) throw new BadGatewayException('الكشف غير مكتمل؛ لم يتم إصدار PDF');
    const items = rows.map((r: any) => ({
      id: `${r.DOCUMENT_SERIAL ?? 'doc'}-${r.RN}`, date: r.DOCUMENT_DATE,
      documentType: ({ '0': 'رصيد افتتاحي', '1': 'قيد يومية', '2': 'سند قبض', '3': 'سند صرف',
        '4': 'فاتورة مبيعات', '5': 'مردود مبيعات', '50': 'قيد فروق عملة' } as Record<string, string>)[r.DOCUMENT_TYPE] ?? `مستند ${r.DOCUMENT_TYPE}`,
      documentNumber: r.DOCUMENT_NUMBER ?? null,
      reference: r.REF_NO ?? null, description: r.DOC_DESC ?? null,
      debit: amount(r.DEBIT).toNumber(), credit: amount(r.CREDIT).toNumber(),
      runningBalance: opening.plus(amount(r.PERIOD_RUNNING)).toNumber(),
    }));
    return { currency: q.currency, openingBalance: opening.toNumber(), periodStartBalance: opening.toNumber(),
      periodEndBalance: end.toNumber(), currentBalance: end.toNumber(), accountingBalance: end.toNumber(),
      equationClosed: true, totalDebit: amount(first.TOTAL_DEBIT).toNumber(), totalCredit: amount(first.TOTAL_CREDIT).toNumber(),
      source: 'oracle_archive', readAt: data.readAt as string, coverageStart: data.coverageStart as string,
      balanceAsOf: q.toDate, page: 1, limit: items.length, total: items.length, totalPages: 1, items };
  }
}
