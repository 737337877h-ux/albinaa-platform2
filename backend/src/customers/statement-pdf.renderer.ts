import PDFDocument from 'pdfkit';
import path from 'node:path';
import { brandingLogoBuffer, resolveBranding } from '../common/branding';

export type StatementPdfTemplate = 'classic' | 'branded';

export interface StatementPdfCustomer {
  name: string;
  externalCustomerCode: string;
  organization: { name: string; systemSettings?: { key: string; value: unknown }[] };
}
export interface StatementPdfSummary {
  periodStartBalance: number;
  periodEndBalance: number;
  currentBalance: number;
}

export interface StatementPdfRow {
  date: Date | string;
  documentType: string;
  documentNumber: string | null;
  reference: string | null;
  description: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface StatementPdfOptions {
  currency: string;
  fromDate?: string;
  toDate?: string;
  template?: StatementPdfTemplate;
  printedBy?: string;
  sourceNote?: string;
  accountGroupLabel?: string;
}


function fmt(value: number, decimals = 2): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function dateText(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('en-GB', { timeZone: 'UTC' });
}

function classicRowDateText(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { timeZone: 'UTC' });
}

function dateTimeText(value: Date): string {
  const date = dateText(value);
  const time = value.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Aden', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `${date}-${time}`;
}

function balanceSide(value: number): string {
  return value >= 0 ? 'مدين' : 'دائن';
}

function pdfText(value: string): string {
  // Accounting exports occasionally contain non-printing control characters.
  // Remove them before PDFKit turns them into visible missing-glyph squares.
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/\s*\/\s*(?=[\u0600-\u06ff])/gu, ' - ');
}

function registerFonts(document: PDFKit.PDFDocument) {
  const fontDir = path.resolve(__dirname, '../../assets/fonts');
  document.registerFont('Arabic', path.join(fontDir, 'AlbinaaStatement-Regular.ttf'));
  document.registerFont('ArabicBold', path.join(fontDir, 'AlbinaaStatement-Bold.ttf'));
  document.registerFont('Latin', path.join(fontDir, 'NotoSans-Regular.ttf'));
  document.registerFont('LatinBold', path.join(fontDir, 'NotoSans-Bold.ttf'));
}

function collect(document: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  return new Promise((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });
}

function arabic(
  document: PDFKit.PDFDocument,
  value: string,
  x: number,
  y: number,
  options: PDFKit.Mixins.TextOptions & { width: number },
) {
  // FontKit chooses run direction from the first strong character. Only an
  // Arabic-leading run reverses embedded Latin/digits; Latin-leading YR must stay LTR.
  const clean = pdfText(value);
  const firstStrong = clean.match(/[A-Za-z\u0600-\u06ff]/u)?.[0];
  const shaped = firstStrong && /[\u0600-\u06ff]/u.test(firstStrong)
    ? clean.replace(/[A-Za-z0-9]+(?:[.,:/-][A-Za-z0-9]+)*/g, token => [...token].reverse().join(''))
    : clean;
  document.text(shaped, x, y, { ...options, features: ['rtla'] });
}

function tableText(
  document: PDFKit.PDFDocument,
  value: string,
  x: number,
  y: number,
  options: PDFKit.Mixins.TextOptions & { width: number },
) {
  if (/[\u0600-\u06ff]/u.test(value)) {
    document.font('Arabic');
    arabic(document, value, x, y, options);
  }
  else document.font('Latin').text(pdfText(value), x, y, options);
}

function boldText(
  document: PDFKit.PDFDocument,
  value: string,
  x: number,
  y: number,
  options: PDFKit.Mixins.TextOptions & { width: number },
) {
  if (/[^\u0000-\u007f]/u.test(value)) {
    document.font('ArabicBold');
    arabic(document, value, x, y, options);
  } else document.font('LatinBold').text(pdfText(value), x, y, options);
}

function drawConfiguredLogo(
  document: PDFKit.PDFDocument,
  customer: StatementPdfCustomer,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const brand = resolveBranding(customer.organization.name, customer.organization.systemSettings);
  const logo = brandingLogoBuffer(brand.logoDataUrl);
  if (!logo) return false;
  try {
    document.image(logo, x, y, { fit: [width, height], align: 'center', valign: 'center' });
    return true;
  } catch {
    return false;
  }
}

function drawPageNumber(document: PDFKit.PDFDocument, printedBy = 'مدير النظام', sourceNote?: string) {
  const pages = document.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    document.switchToPage(index);
    if (sourceNote) {
      document.font('Arabic').fontSize(6);
      arabic(document, 'صادر من المنصة - وقت قراءة البيانات', 310, 820, { width: 267, height: 10, align: 'center', lineBreak: false });
      const timestamp = sourceNote.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/)?.[0] ?? '';
      document.font('Latin').text(`Oracle | ${timestamp} (UTC)`, 18, 820, { width: 290, height: 10, align: 'center', lineBreak: false });
    }
    document.moveTo(18, 798).lineTo(577, 798).lineWidth(0.45).stroke('#111111');
    document.font('Arabic').fontSize(6.5).fillColor('#111111');
    document.font('Latin').text(`${index + 1} / ${pages.count}`, 250, 806, {
      width: 95, height: 10, align: 'center', lineBreak: false,
    });
    const printer = pdfText(printedBy || 'مدير النظام');
    document.font('Arabic');
    arabic(document, 'طبع بواسطة:', 88, 806, {
      width: 80, height: 10, align: 'left', lineBreak: false,
    });
    document.fontSize(6.5);
    tableText(document, printer, 18, 806, {
      width: 68, height: 10, align: 'left', lineBreak: false, ellipsis: '...',
    });
    document.font('Arabic');
    arabic(document, 'تاريخ التقرير:', 489, 806, { width: 84, height: 10, align: 'right', lineBreak: false });
    document.font('Latin').text(dateTimeText(new Date()), 386, 806, { width: 101, height: 10, align: 'right', lineBreak: false });
  }
}

function drawClassicHeader(
  document: PDFKit.PDFDocument,
  customer: StatementPdfCustomer,
  summary: StatementPdfSummary,
  options: StatementPdfOptions,
) {
  const brand = resolveBranding(customer.organization.name, customer.organization.systemSettings);
  document.font('ArabicBold').fontSize(13.4).fillColor('#000000');
  arabic(document, brand.name, 342, 18, { width: 220, align: 'right' });
  document.font('Arabic').fontSize(7.4);
  arabic(document, brand.subtitle, 342, 40, { width: 220, align: 'right' });

  document.roundedRect(214, 104, 140, 18, 6).lineWidth(0.65).stroke('#000000');
  document.font('ArabicBold').fontSize(8.7);
  arabic(document, brand.statementTitle, 214, 106, {
    width: 140, align: 'center', underline: true,
  });

  const customerBoxX = 314;
  const customerBoxY = 126;
  const customerBoxWidth = 249;
  document.roundedRect(customerBoxX, customerBoxY, customerBoxWidth, 37, 7).lineWidth(0.55).stroke('#000000');
  document.font('Arabic').fontSize(7.4);
  arabic(document, 'اسم الحساب', 497, customerBoxY + 4, { width: 58, align: 'right' });
  document.font('ArabicBold').fontSize(7.5);
  arabic(document, customer.name, 322, customerBoxY + 4, { width: 172, height: 12, align: 'right', ellipsis: true });
  document.font('Arabic').fontSize(7.4);
  arabic(document, 'رقم الحساب', 497, customerBoxY + 20, { width: 58, align: 'right' });
  document.font('LatinBold').fontSize(8.2).text(customer.externalCustomerCode, 322, customerBoxY + 20, {
    width: 172, height: 12, align: 'right', lineBreak: false,
  });

  const from = options.fromDate ? dateText(options.fromDate) : 'البداية';
  const to = options.toDate ? dateText(options.toDate) : dateText(new Date());
  document.roundedRect(2, 131, 273, 15, 6).lineWidth(0.55).stroke('#000000');
  document.font('ArabicBold').fontSize(7.1);
  arabic(document, 'للفترة من', 205, 133, { width: 62, align: 'right' });
  boldText(document, from, 125, 133, { width: 76, align: 'center' });
  document.font('ArabicBold');
  arabic(document, 'إلى', 98, 133, { width: 24, align: 'center' });
  document.font('LatinBold').text(to, 13, 133, { width: 82, align: 'center' });
  document.roundedRect(2, 148, 273, 15, 6).lineWidth(0.55).stroke('#000000');
  document.font('ArabicBold').fontSize(7.2);
  arabic(document, 'الرصيد الحالي', 194, 150, { width: 73, align: 'right' });
  document.fillColor('#c62828').font('LatinBold').fontSize(8.4).text(fmt(Math.abs(summary.currentBalance)), 48, 149.5, {
    width: 140, align: 'right', lineBreak: false,
  });
  document.fillColor('#000000').font('Arabic').fontSize(7.5);
  arabic(document, balanceSide(summary.currentBalance), 7, 150, { width: 37, align: 'center' });
}

const CLASSIC_COLUMNS = [2, 91, 165, 236, 406, 470, 509];
const CLASSIC_WIDTHS = [89, 74, 71, 170, 64, 39, 55];
const CLASSIC_HEADERS = ['الرصيد', 'دائن', 'مدين', 'البيان', 'المرجع', 'المستند', 'التاريخ'];

function drawClassicTableHeader(document: PDFKit.PDFDocument, y: number) {
  document.roundedRect(2, y, 562, 19, 7).lineWidth(0.8).stroke('#000000');
  document.font('ArabicBold').fontSize(8.3).fillColor('#000000');
  CLASSIC_HEADERS.forEach((label, index) => {
    arabic(document, label, CLASSIC_COLUMNS[index] + 2, y + 4, { width: CLASSIC_WIDTHS[index] - 4, align: 'center' });
    if (index > 0) document.moveTo(CLASSIC_COLUMNS[index], y).lineTo(CLASSIC_COLUMNS[index], y + 19).lineWidth(0.45).stroke('#000000');
  });
  document.moveTo(2, y + 19).lineTo(564, y + 19).lineWidth(0.8).stroke('#000000');
  return y + 19;
}

function drawClassicBalanceCell(
  document: PDFKit.PDFDocument,
  value: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  document.fillColor('#000000').font('Arabic').fontSize(5.8);
  arabic(document, balanceSide(value), x + 2, y + 4, { width: 20, height: height - 5, align: 'left', lineBreak: false });
  document.font('Latin').fontSize(8.2).text(fmt(Math.abs(value)), x + 23, y + 3, {
    width: width - 26, height: height - 4, align: 'right', lineBreak: false,
  });
}

function drawClassicRow(
  document: PDFKit.PDFDocument,
  values: string[],
  balance: number,
  y: number,
  height = 16,
  drawBottomDivider = true,
  drawOuterEdges = true,
) {
  document.fillColor('#000000');
  values.forEach((value, index) => {
    if (index === 0) drawClassicBalanceCell(document, balance, CLASSIC_COLUMNS[index], y, CLASSIC_WIDTHS[index], height);
    else {
      document.fontSize(index === 3 ? 8 : index >= 5 ? 8.5 : 8.2);
      tableText(document, value, CLASSIC_COLUMNS[index] + 3, y + 3, {
        width: CLASSIC_WIDTHS[index] - 6,
        height: height - 4,
        ellipsis: index !== 3,
        align: 'right',
        lineBreak: false,
      });
    }
    if (index > 0) document.moveTo(CLASSIC_COLUMNS[index], y).lineTo(CLASSIC_COLUMNS[index], y + height).lineWidth(0.35).stroke('#000000');
  });
  if (drawBottomDivider) {
    document.save().dash(3, { space: 2 }).moveTo(2, y + height).lineTo(564, y + height)
      .lineWidth(0.35).stroke('#000000').undash().restore();
  }
  if (drawOuterEdges) {
    document.moveTo(2, y).lineTo(2, y + height).lineWidth(0.35).stroke('#000000');
    document.moveTo(564, y).lineTo(564, y + height).lineWidth(0.35).stroke('#000000');
  }
  return y + height;
}

function drawClassicFooters(
  document: PDFKit.PDFDocument,
  legalText: string,
  printedBy: string,
) {
  const pages = document.bufferedPageRange();
  const printedAt = new Date();
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    document.switchToPage(index);
    document.fillColor('#000000').font('ArabicBold').fontSize(6.8);
    arabic(document, legalText, 55, 792, { width: 509, height: 13, align: 'right', lineBreak: false, ellipsis: true });
    document.moveTo(2, 812).lineTo(564, 812).lineWidth(0.4).stroke('#000000');
    document.font('Latin').fontSize(6.2).text(`Page :${index + 1}`, 2, 822, {
      width: 80, height: 10, align: 'left', lineBreak: false,
    });
    document.font('Latin').text(`Prepared by: ${printedBy} / ${dateTimeText(printedAt)}`, 279, 822, {
      width: 285, height: 10, align: 'right', lineBreak: false,
    });
  }
}

async function renderClassic(
  customer: StatementPdfCustomer,
  summary: StatementPdfSummary,
  rows: StatementPdfRow[],
  options: StatementPdfOptions,
): Promise<Buffer> {
  const brand = resolveBranding(customer.organization.name, customer.organization.systemSettings);
  const document = new PDFDocument({ size: 'A4', margin: 18, bufferPages: true, info: { Title: `كشف حساب ${customer.name}` } });
  registerFonts(document);
  const completed = collect(document);
  drawClassicHeader(document, customer, summary, options);
  let y = drawClassicTableHeader(document, 165.5);
  let debitTotal = 0;
  let creditTotal = 0;
  const openingDate = options.fromDate ?? (rows[0]?.date ?? new Date());
  y = drawClassicRow(document, [
    '', '', '', 'الرصيد الافتتاحي', '', '', classicRowDateText(openingDate),
  ], summary.periodStartBalance, y);
  for (const row of rows) {
    if (y > 735) {
      document.addPage();
      drawClassicHeader(document, customer, summary, options);
      y = drawClassicTableHeader(document, 165.5);
    }
    debitTotal += row.debit;
    creditTotal += row.credit;
    const values = [
      '',
      row.credit ? fmt(row.credit) : '',
      row.debit ? fmt(row.debit) : '',
      row.description || '-',
      row.reference || '-',
      row.documentNumber || row.documentType || '',
      classicRowDateText(row.date),
    ];
    y = drawClassicRow(document, values, row.runningBalance, y);
  }

  if (y > 718) {
    document.addPage();
    drawClassicHeader(document, customer, summary, options);
    y = drawClassicTableHeader(document, 165.5);
  }
  document.moveTo(2, y).lineTo(564, y).lineWidth(0.65).stroke('#000000');
  document.moveTo(2, y + 2).lineTo(564, y + 2).lineWidth(0.35).stroke('#000000');
  CLASSIC_COLUMNS.slice(1).forEach((x) => document.moveTo(x, y).lineTo(x, y + 19).lineWidth(0.35).stroke('#000000'));
  document.moveTo(2, y).lineTo(2, y + 19).stroke('#000000');
  document.moveTo(564, y).lineTo(564, y + 19).stroke('#000000');
  document.font('ArabicBold').fontSize(8);
  arabic(document, 'المجموع الكلي', 239, y + 5, { width: 164, align: 'right' });
  document.font('LatinBold').fontSize(8.2).text(fmt(debitTotal), 168, y + 5, { width: 65, align: 'right', lineBreak: false });
  document.text(fmt(creditTotal), 94, y + 5, { width: 68, align: 'right', lineBreak: false });
  document.moveTo(2, y + 17).lineTo(564, y + 17).lineWidth(0.35).stroke('#000000');
  document.moveTo(2, y + 19).lineTo(564, y + 19).lineWidth(0.65).stroke('#000000');
  y += 19;

  const endingDate = options.toDate ?? (rows.at(-1)?.date ?? new Date());
  drawClassicRow(document, [
    '', '', '', 'الرصيد النهائي', '', '', classicRowDateText(endingDate),
  ], summary.periodEndBalance, y, 18, false, false);
  document.roundedRect(2, 165.5, 562, y + 18 - 165.5, 7).lineWidth(0.65).stroke('#000000');
  drawClassicFooters(document, brand.statementFooter, options.printedBy || 'system');
  document.end();
  return completed;
}

function drawBrandMark(document: PDFKit.PDFDocument, x: number, y: number) {
  document.save();
  document.fillColor('#c59b27').rect(x, y + 8, 12, 26).fill();
  document.fillColor('#0f4c3a').rect(x + 15, y, 12, 34).fill();
  document.fillColor('#d9b44a').rect(x + 30, y + 14, 12, 20).fill();
  document.restore();
}

function drawLegacyStatementLogo(
  document: PDFKit.PDFDocument,
  customer: StatementPdfCustomer,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  try {
    document.image(path.resolve(__dirname, '../../assets/branding/statement-logo.jpg'), x, y, {
      fit: [width, height], align: 'center', valign: 'center',
    });
    return;
  } catch {
    // Fall back to the configured logo when the legacy report asset is absent.
  }
  if (!drawConfiguredLogo(document, customer, x, y, width, height)) {
    drawBrandMark(document, x + Math.max(0, (width - 42) / 2), y + Math.max(0, (height - 34) / 2));
  }
}

function currencyArabicName(currency: string): string {
  if (currency === 'YER') return 'ريال يمني';
  if (currency === 'SAR') return 'ريال سعودي';
  if (currency === 'USD') return 'دولار أمريكي';
  return currency;
}

function drawBrandedHeader(
  document: PDFKit.PDFDocument,
  customer: StatementPdfCustomer,
  options: StatementPdfOptions,
) {
  const brand = resolveBranding(customer.organization.name, customer.organization.systemSettings);
  const phone = brand.phone || '695988 - 695989';
  document.roundedRect(28, 4, 559, 103, 10).lineWidth(1.35).stroke('#111111');

  // Match the Oracle printout: company identity only, without the platform name.
  document.font('LatinBold').fontSize(8.1).fillColor('#111111');
  document.text('Al-Bena Al-Raqi For Gen. Trading - 1', 34, 10, {
    width: 217, height: 12, align: 'left', lineBreak: false,
  });
  document.fontSize(8);
  document.text('Reinforcement Steel - Building Materials\n& Electricity Sanitary Wares', 34, 24, {
    width: 217, height: 28, lineGap: 1, align: 'left',
  });
  document.fontSize(7.4);
  document.text("Sana'a - Hezyis - Near to\nAl-Wahda Marketing", 34, 53, {
    width: 217, height: 27, lineGap: 1, align: 'left',
  });
  document.text(`Tel.:${phone}`, 34, 84, { width: 217, height: 11, align: 'left', lineBreak: false });

  document.font('ArabicBold').fontSize(8.2);
  arabic(document, 'البناء الراقي للتجارة العامة - المركز الرئيسي', 365, 10, {
    width: 213, height: 13, align: 'right', lineBreak: false,
  });
  arabic(document, 'حديد - مواد بناء و كهرباء - مواد سباكة', 365, 25, {
    width: 213, height: 13, align: 'right', lineBreak: false,
  });
  arabic(document, 'أدوات صحية', 365, 40, { width: 213, height: 12, align: 'right', lineBreak: false });
  document.fontSize(7.4);
  arabic(document, 'صنعاء - حزيز - جوار سوق الوحدة', 365, 56, {
    width: 213, height: 12, align: 'right', lineBreak: false,
  });
  arabic(document, 'تلفون:', 535, 84, { width: 43, height: 11, align: 'right', lineBreak: false });
  document.font('LatinBold').fontSize(7.4).text('695988 - 695989', 430, 84, {
    width: 101, height: 11, align: 'right', lineBreak: false,
  });

  drawLegacyStatementLogo(document, customer, 270, 7, 58, 58);
  document.font('ArabicBold').fontSize(8.7);
  arabic(document, options.sourceNote ? 'كشف حساب - صادر من المنصة' : 'كشف حساب تحليلي قبل الترحيل - رصيد نهاية التقرير', 178, 67, {
    width: 239, height: 15, align: 'center', lineBreak: false,
  });

  const from = options.fromDate ? dateText(options.fromDate) : 'البداية';
  const to = options.toDate ? dateText(options.toDate) : dateText(new Date());
  document.font('ArabicBold').fontSize(7.3);
  arabic(document, 'من تاريخ:', 342, 87, { width: 70, height: 11, align: 'right', lineBreak: false });
  boldText(document, from, 266, 87, { width: 74, height: 11, align: 'center', lineBreak: false });
  document.font('ArabicBold');
  arabic(document, 'إلى تاريخ:', 193, 87, { width: 68, height: 11, align: 'right', lineBreak: false });
  document.font('LatinBold').text(to, 116, 87, { width: 74, height: 11, align: 'center', lineBreak: false });

  // A single information band without boxes around each account field.
  document.rect(32, 115, 555, 45).lineWidth(0.5).stroke('#222222');
  document.font('ArabicBold').fontSize(7.4).fillColor('#111111');
  arabic(document, 'رقم الحساب', 507, 119, { width: 64, height: 11, align: 'right', lineBreak: false });
  document.font('LatinBold').fontSize(8.2).fillColor('#a00000').text(options.sourceNote ? '-' : '112101001', 433, 119, {
    width: 69, height: 11, align: 'center', lineBreak: false,
  });
  document.font('ArabicBold').fontSize(7.4).fillColor('#111111');
  arabic(document, 'الحساب التحليلي', 507, 134, { width: 64, height: 11, align: 'right', lineBreak: false });
  document.font('LatinBold').fontSize(8.2).fillColor('#a00000').text(customer.externalCustomerCode, 433, 134, {
    width: 69, height: 11, align: 'center', lineBreak: false,
  });
  document.font('ArabicBold').fontSize(7.2).fillColor('#111111');
  arabic(document, options.accountGroupLabel ?? 'عملاء الادارة العامة', 305, 119, { width: 110, height: 11, align: 'right', lineBreak: false });
  arabic(document, customer.name, 270, 134, {
    width: 145, height: 12, align: 'right', ellipsis: '...', lineBreak: false,
  });
  arabic(document, 'العملة :', 181, 146, { width: 55, height: 11, align: 'right', lineBreak: false });
  document.font('LatinBold').fontSize(8.2).fillColor('#a00000').text(options.currency, 148, 146, {
    width: 31, height: 11, align: 'center', lineBreak: false,
  });
  document.font('ArabicBold').fontSize(7.3).fillColor('#111111');
  arabic(document, currencyArabicName(options.currency), 96, 146, {
    width: 48, height: 11, align: 'right', lineBreak: false,
  });
}

// Physical order on the page is left-to-right, while the report reads right-to-left:
// الرصيد ← المبلغ (دائن، مدين) ← المرجع ← البيان ← رقم المستند ← النوع ← التاريخ.
const BRAND_COLUMNS = [32, 96, 162, 233, 287, 418, 457, 539];
const BRAND_WIDTHS = [64, 66, 71, 54, 131, 39, 82, 48];

function drawBrandedTableHeader(document: PDFKit.PDFDocument, y: number) {
  const height = 31;
  document.rect(32, y, 555, height).fillAndStroke('#b9d9f2', '#111111');
  document.font('ArabicBold').fontSize(8).fillColor('#111111');

  const fullHeaders = [
    { label: 'الرصيد', index: 0 },
    { label: 'رقم المرجع', index: 3 },
    { label: 'البيان', index: 4 },
    { label: 'نوع المستند', index: 6 },
    { label: 'التاريخ', index: 7 },
  ];
  fullHeaders.forEach(({ label, index }) => {
    document.font('ArabicBold').fontSize(8);
    arabic(document, label, BRAND_COLUMNS[index] + 2, y + 8, {
      width: BRAND_WIDTHS[index] - 4, height: 20, align: 'center', lineBreak: true,
    });
  });

  document.font('ArabicBold').fontSize(6.8);
  arabic(document, 'رقم', BRAND_COLUMNS[5] + 2, y + 3, {
    width: BRAND_WIDTHS[5] - 4, height: 11, align: 'center', lineBreak: false,
  });
  arabic(document, 'المستند', BRAND_COLUMNS[5] + 2, y + 16, {
    width: BRAND_WIDTHS[5] - 4, height: 11, align: 'center', lineBreak: false,
  });

  document.font('ArabicBold').fontSize(8);
  arabic(document, 'المبلغ', BRAND_COLUMNS[1] + 2, y + 1, {
    width: BRAND_WIDTHS[1] + BRAND_WIDTHS[2] - 4, height: 12, align: 'center', lineBreak: false,
  });
  document.moveTo(BRAND_COLUMNS[1], y + 14).lineTo(BRAND_COLUMNS[3], y + 14).lineWidth(0.45).stroke('#111111');
  arabic(document, 'دائن', BRAND_COLUMNS[1] + 2, y + 16, { width: BRAND_WIDTHS[1] - 4, height: 12, align: 'center', lineBreak: false });
  arabic(document, 'مدين', BRAND_COLUMNS[2] + 2, y + 16, { width: BRAND_WIDTHS[2] - 4, height: 12, align: 'center', lineBreak: false });

  for (let index = 1; index < BRAND_COLUMNS.length; index += 1) {
    const lineTop = index === 2 ? y + 14 : y;
    document.moveTo(BRAND_COLUMNS[index], lineTop).lineTo(BRAND_COLUMNS[index], y + height)
      .lineWidth(0.45).stroke('#111111');
  }
  return y + height;
}

function drawBrandedRow(
  document: PDFKit.PDFDocument,
  values: string[],
  y: number,
  height: number,
  opening = false,
) {
  document.rect(32, y, 555, height).lineWidth(0.32).stroke('#333333');
  values.forEach((value, index) => {
    if (index > 0) {
      document.moveTo(BRAND_COLUMNS[index], y).lineTo(BRAND_COLUMNS[index], y + height)
        .lineWidth(0.32).stroke('#333333');
    }
    document.fontSize(index === 4 ? 7.1 : 6.9).fillColor(opening && index === 4 ? '#9b111e' : '#111111');
    if (opening && index === 4) document.font('ArabicBold');
    const align = [0, 1, 2].includes(index) ? 'right' : [4, 6].includes(index) ? 'right' : 'center';
    tableText(document, value, BRAND_COLUMNS[index] + 2, y + 2, {
      width: BRAND_WIDTHS[index] - 4,
      height: height - 3,
      // Constrain every cell to its calculated row box. Without ellipsis on
      // long Arabic descriptions PDFKit can flow the remainder onto a new,
      // unbranded continuation page.
      ellipsis: '...',
      align,
      lineGap: 0,
    });
  });
  return y + height;
}

async function renderBranded(
  customer: StatementPdfCustomer,
  summary: StatementPdfSummary,
  rows: StatementPdfRow[],
  options: StatementPdfOptions,
): Promise<Buffer> {
  const brand = resolveBranding(customer.organization.name, customer.organization.systemSettings);
  const document = new PDFDocument({ size: 'A4', margin: 18, bufferPages: true, info: { Title: `كشف حساب ${customer.name}` } });
  registerFonts(document);
  const completed = collect(document);
  drawBrandedHeader(document, customer, options);
  let y = drawBrandedTableHeader(document, 160);
  let debitTotal = 0;
  let creditTotal = 0;

  y = drawBrandedRow(document, [
    fmt(summary.periodStartBalance), '', '', '', 'الرصيد الافتتاحي', '', '',
    options.fromDate ? dateText(options.fromDate) : (rows[0]?.date ? dateText(rows[0].date) : '-'),
  ], y, 15, true);

  for (const row of rows) {
    document.font('Arabic').fontSize(7.1);
    const descriptionHeight = document.heightOfString(pdfText(row.description || '-'), {
      width: BRAND_WIDTHS[4] - 6,
      features: ['rtla'],
      lineGap: 0,
    });
    const typeHeight = document.heightOfString(pdfText(row.documentType || '-'), {
      width: BRAND_WIDTHS[6] - 6,
      features: ['rtla'],
      lineGap: 0,
    });
    const measuredHeight = Math.max(15, descriptionHeight + 6, typeHeight + 6);
    if (options.sourceNote && measuredHeight > 540) throw new Error('بيان الحركة يتجاوز مساحة صفحة الكشف؛ يلزم مراجعته قبل إصدار PDF');
    const height = options.sourceNote ? measuredHeight : Math.min(28, measuredHeight);
    // Leave enough space for PDFKit's line layout so it never auto-creates a
    // continuation page without the branded header and column headings.
    if (y + height > 755) {
      document.addPage();
      drawBrandedHeader(document, customer, options);
      y = drawBrandedTableHeader(document, 160);
    }
    debitTotal += row.debit;
    creditTotal += row.credit;
    y = drawBrandedRow(document, [
      fmt(row.runningBalance),
      row.credit ? fmt(row.credit) : '',
      row.debit ? fmt(row.debit) : '',
      row.reference || '',
      row.description || '-',
      row.documentNumber || '-',
      row.documentType || '-',
      dateText(row.date),
    ], y, height);
  }

  if (y + 105 > 755) {
    document.addPage();
    drawBrandedHeader(document, customer, options);
    y = drawBrandedTableHeader(document, 160);
  }

  const totalsY = y;
  document.rect(32, totalsY, 555, 16).lineWidth(0.6).stroke('#111111');
  BRAND_COLUMNS.slice(1).forEach((x) => {
    document.moveTo(x, totalsY).lineTo(x, totalsY + 16).lineWidth(0.32).stroke('#333333');
  });
  document.font('ArabicBold').fontSize(7.4).fillColor('#9b111e');
  arabic(document, 'العدد:', BRAND_COLUMNS[7] + 2, totalsY + 3, { width: BRAND_WIDTHS[7] - 4, align: 'center' });
  document.font('LatinBold').fontSize(7.7).text(String(rows.length), BRAND_COLUMNS[6] + 2, totalsY + 3, {
    width: BRAND_WIDTHS[6] - 4, align: 'center', lineBreak: false,
  });
  document.font('ArabicBold').fontSize(7.4);
  arabic(document, 'إجمالي العمليات', BRAND_COLUMNS[4] + 2, totalsY + 3, {
    width: BRAND_WIDTHS[4] + BRAND_WIDTHS[5] - 4, align: 'center', lineBreak: false,
  });
  document.font('LatinBold').fontSize(7.4).text(options.currency, BRAND_COLUMNS[3] + 2, totalsY + 3, {
    width: BRAND_WIDTHS[3] - 4, align: 'center', lineBreak: false,
  });
  document.font('LatinBold').fontSize(7.4);
  document.text(fmt(creditTotal), BRAND_COLUMNS[1] + 2, totalsY + 3, { width: BRAND_WIDTHS[1] - 4, align: 'right', lineBreak: false });
  document.text(fmt(debitTotal), BRAND_COLUMNS[2] + 2, totalsY + 3, { width: BRAND_WIDTHS[2] - 4, align: 'right', lineBreak: false });

  const balanceY = totalsY + 16;
  document.rect(32, balanceY, 555, 16).lineWidth(0.55).stroke('#111111');
  [96, 162, 233, 457].forEach((x) => {
    document.moveTo(x, balanceY).lineTo(x, balanceY + 16).lineWidth(0.32).stroke('#333333');
  });
  document.font('ArabicBold').fontSize(7.2).fillColor('#111111');
  arabic(document, `إجمالي الرصيد ${summary.periodEndBalance >= 0 ? 'عليكم' : 'لكم'}`, 459, balanceY + 3, {
    width: 124, height: 11, align: 'right', lineBreak: false,
  });
  document.font('LatinBold').fontSize(8).fillColor('#9b111e').text(fmt(Math.abs(summary.periodEndBalance)), 164, balanceY + 3, {
    width: 67, align: 'right', lineBreak: false,
  });

  document.fillColor('#111111').font('ArabicBold').fontSize(7.2);
  arabic(document, brand.statementFooter, 38, balanceY + 21, {
    width: 525, height: 22, align: 'center', lineBreak: true,
  });
  const sigY = balanceY + 43;
  const signatures = ['المدير العام', 'المدير المالي', 'المراجع', 'المحاسب'];
  signatures.forEach((label, index) => {
    const x = 25 + index * 137;
    document.font('ArabicBold').fontSize(7.4).fillColor('#111111');
    arabic(document, label, x, sigY, { width: 110, align: 'center' });
    document.moveTo(x + 8, sigY + 23).lineTo(x + 102, sigY + 23).lineWidth(0.4).stroke('#111111');
  });
  drawPageNumber(document, options.printedBy, options.sourceNote);
  document.end();
  return completed;
}

export function renderCustomerStatementPdf(
  customer: StatementPdfCustomer,
  summary: StatementPdfSummary,
  rows: StatementPdfRow[],
  options: StatementPdfOptions,
): Promise<Buffer> {
  return options.template === 'classic'
    ? renderClassic(customer, summary, rows, options)
    : renderBranded(customer, summary, rows, options);
}
