import { renderCustomerStatementPdf, StatementPdfRow } from './statement-pdf.renderer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const customer = {
  name: 'نموذج اختبار اتجاه كشف الحساب',
  externalCustomerCode: '30986',
  organization: { name: 'البناء الراقي', systemSettings: [] },
};

function rows(count: number): StatementPdfRow[] {
  const types = [
    'قيد يومية',
    'سند قبض نقدي',
    'سند صرف نقدي',
    'فاتورة المبيعات آجل',
    'فاتورة مردود المبيعات آجل',
    'أمر توريد مخزني',
  ];
  let runningBalance = 0;
  return Array.from({ length: count }, (_, index) => {
    const debit = index % 3 === 0 ? 1_250 : 0;
    const credit = debit ? 0 : 425;
    runningBalance += debit - credit;
    return {
      date: `2026-08-${String((index % 15) + 1).padStart(2, '0')}`,
      documentType: types[index % types.length],
      documentNumber: String(1_000 + index),
      reference: index % 2 ? `REF-${index}` : null,
      description: `بيان عربي لاختبار اتجاه الصف رقم ${index + 1} ومحاذاة النص داخل العمود`,
      debit,
      credit,
      runningBalance,
    };
  });
}

function pdfPageCount(buffer: Buffer): number {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
}

describe('branded customer statement PDF', () => {
  it.each(['YER', 'SAR', 'USD'] as const)('renders a compact one-page RTL statement for %s', async (currency) => {
    const movements = rows(7);
    const periodEndBalance = movements.at(-1)?.runningBalance ?? 0;
    const buffer = await renderCustomerStatementPdf(customer, {
      periodStartBalance: 0,
      periodEndBalance,
      currentBalance: periodEndBalance,
    }, movements, {
      currency,
      fromDate: '2026-08-01',
      toDate: '2026-08-15',
      template: 'branded',
      printedBy: 'admin3',
    });

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(20_000);
    expect(pdfPageCount(buffer)).toBe(1);
  });

  it('paginates long statements without creating an empty trailing page', async () => {
    const movements = rows(70);
    const periodEndBalance = movements.at(-1)?.runningBalance ?? 0;
    const buffer = await renderCustomerStatementPdf(customer, {
      periodStartBalance: 0,
      periodEndBalance,
      currentBalance: periodEndBalance,
    }, movements, {
      currency: 'YER',
      fromDate: '2026-08-01',
      toDate: '2026-08-15',
      template: 'branded',
      printedBy: 'admin3',
      sourceNote: 'صادر من المنصة - قراءة Oracle: 2026-09-06T12:00:00Z',
      accountGroupLabel: 'حسابات السلف',
    });

    expect(pdfPageCount(buffer)).toBeGreaterThanOrEqual(3);
    expect(pdfPageCount(buffer)).toBeLessThanOrEqual(6);

    const qaOutput = process.env.STATEMENT_PDF_QA_OUTPUT;
    if (qaOutput) {
      mkdirSync(dirname(qaOutput), { recursive: true });
      writeFileSync(qaOutput, buffer);
    }
  });
});
