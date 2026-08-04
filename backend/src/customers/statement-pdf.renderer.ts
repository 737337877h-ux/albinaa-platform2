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
}

const LEFT = 18;

function fmt(value: number, decimals = 2): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function dateText(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('en-GB', { timeZone: 'UTC' });
}

function registerFonts(document: PDFKit.PDFDocument) {
  const fontDir = path.resolve(__dirname, '../../assets/fonts');
  document.registerFont('Arabic', path.join(fontDir, 'NotoSansArabic-Regular.ttf'));
  document.registerFont('ArabicBold', path.join(fontDir, 'NotoSansArabic-Bold.ttf'));
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
  document.text(value, x, y, { ...options, features: ['rtla'] });
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
  else document.font('Latin').text(value, x, y, options);
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
  } else document.font('LatinBold').text(value, x, y, options);
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

function drawPageNumber(document: PDFKit.PDFDocument) {
  const pages = document.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    document.switchToPage(index);
    document.font('Arabic').fontSize(6.5).fillColor('#111111');
    document.font('Latin').text(`${index + 1} / ${pages.count}`, 250, 806, {
      width: 95, height: 10, align: 'center', lineBreak: false,
    });
    document.font('Arabic');
    arabic(document, 'طبع بواسطة: مدير النظام', LEFT, 806, {
      width: 180, height: 10, align: 'left', lineBreak: false,
    });
    arabic(document, 'تاريخ التقرير:', 468, 806, { width: 107, height: 10, align: 'right', lineBreak: false });
    document.font('Latin').text(dateText(new Date()), 390, 806, { width: 78, height: 10, align: 'right', lineBreak: false });
  }
}

function drawClassicHeader(
  document: PDFKit.PDFDocument,
  customer: StatementPdfCustomer,
  summary: StatementPdfSummary,
  options: StatementPdfOptions,
) {
  const brand = resolveBranding(customer.organization.name, customer.organization.systemSettings);
  document.font('ArabicBold').fontSize(15).fillColor('#111111');
  arabic(document, brand.name, 285, 22, { width: 275, align: 'right' });
  document.font('ArabicBold').fontSize(9);
  arabic(document, [brand.subtitle, brand.address].filter(Boolean).join(' - '), 285, 45, { width: 275, align: 'right' });
  if (brand.phone) document.font('LatinBold').fontSize(8).text(brand.phone, 125, 45, { width: 145, align: 'left' });
  drawConfiguredLogo(document, customer, 24, 20, 90, 48);

  document.roundedRect(210, 88, 175, 22, 7).lineWidth(1).stroke('#111111');
  document.font('ArabicBold').fontSize(12);
  arabic(document, brand.statementTitle, 210, 91, { width: 175, align: 'center' });

  document.roundedRect(314, 118, 246, 51, 6).stroke('#111111');
  document.font('ArabicBold').fontSize(8.5);
  arabic(document, 'اسم الحساب', 455, 126, { width: 96, align: 'right' });
  tableText(document, customer.name, 323, 126, { width: 128, align: 'right' });
  document.font('ArabicBold');
  arabic(document, 'رقم الحساب', 455, 146, { width: 96, align: 'right' });
  document.font('LatinBold').text(customer.externalCustomerCode, 323, 146, { width: 128, align: 'right' });

  const from = options.fromDate ? dateText(options.fromDate) : 'البداية';
  const to = options.toDate ? dateText(options.toDate) : dateText(new Date());
  document.roundedRect(18, 122, 272, 21, 6).stroke('#111111');
  document.font('ArabicBold').fontSize(8.5);
  arabic(document, 'للفترة من', 205, 127, { width: 76, align: 'right' });
  boldText(document, from, 130, 127, { width: 72, align: 'center' });
  document.font('ArabicBold');
  arabic(document, 'إلى', 103, 127, { width: 25, align: 'center' });
  document.font('LatinBold').text(to, 27, 127, { width: 74, align: 'center' });
  document.roundedRect(18, 146, 272, 21, 6).stroke('#111111');
  const side = summary.currentBalance >= 0 ? 'مدين' : 'دائن';
  document.font('ArabicBold');
  arabic(document, 'الرصيد الحالي', 190, 151, { width: 91, align: 'right' });
  document.font('LatinBold').text(`${fmt(Math.abs(summary.currentBalance))} ${options.currency}`, 66, 151, { width: 121, align: 'center' });
  document.font('ArabicBold');
  arabic(document, side, 27, 151, { width: 37, align: 'center' });
}

const CLASSIC_COLUMNS = [18, 68, 119, 177, 329, 397, 464];
const CLASSIC_WIDTHS = [50, 51, 58, 152, 68, 67, 113];
const CLASSIC_HEADERS = ['التاريخ', 'المستند', 'المرجع', 'البيان', 'مدين', 'دائن', 'الرصيد'];

function drawClassicTableHeader(document: PDFKit.PDFDocument, y: number) {
  document.roundedRect(18, y, 542, 21, 6).lineWidth(0.8).stroke('#111111');
  document.font('ArabicBold').fontSize(7.5).fillColor('#111111');
  CLASSIC_HEADERS.forEach((label, index) => {
    arabic(document, label, CLASSIC_COLUMNS[index] + 2, y + 5, { width: CLASSIC_WIDTHS[index] - 4, align: 'center' });
    if (index > 0) document.moveTo(CLASSIC_COLUMNS[index], y).lineTo(CLASSIC_COLUMNS[index], y + 21).stroke('#111111');
  });
  return y + 22;
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
  let y = drawClassicTableHeader(document, 176);
  let debitTotal = 0;
  let creditTotal = 0;
  for (const row of rows) {
    if (y > 746) {
      document.addPage();
      drawClassicHeader(document, customer, summary, options);
      y = drawClassicTableHeader(document, 176);
    }
    debitTotal += row.debit;
    creditTotal += row.credit;
    const values = [
      dateText(row.date),
      row.documentType || '-',
      row.reference || row.documentNumber || '-',
      row.description || '-',
      row.debit ? fmt(row.debit) : '',
      row.credit ? fmt(row.credit) : '',
      fmt(row.runningBalance),
    ];
    document.font('Arabic').fontSize(6.7).fillColor('#111111');
    values.forEach((value, index) => tableText(document, value, CLASSIC_COLUMNS[index] + 2, y + 3, {
      width: CLASSIC_WIDTHS[index] - 4,
      height: 14,
      ellipsis: index !== 3,
      align: index === 3 ? 'right' : 'center',
    }));
    document.save().dash(3, { space: 3 }).moveTo(18, y + 17).lineTo(560, y + 17).lineWidth(0.35).stroke('#555555').undash().restore();
    CLASSIC_COLUMNS.slice(1).forEach((x) => document.moveTo(x, y).lineTo(x, y + 17).lineWidth(0.35).stroke('#555555'));
    y += 17;
  }

  if (y > 680) {
    document.addPage();
    drawClassicHeader(document, customer, summary, options);
    y = drawClassicTableHeader(document, 176);
  }
  document.font('ArabicBold').fontSize(8);
  arabic(document, 'المجموع الكلي', 177, y + 5, { width: 152, align: 'right' });
  document.font('LatinBold').text(fmt(debitTotal), 331, y + 5, { width: 64, align: 'center' });
  document.text(fmt(creditTotal), 399, y + 5, { width: 63, align: 'center' });
  document.moveTo(18, y).lineTo(560, y).stroke('#111111');
  document.moveTo(18, y + 20).lineTo(560, y + 20).stroke('#111111');
  document.font('ArabicBold');
  arabic(document, 'الرصيد النهائي', 177, y + 28, { width: 152, align: 'right' });
  document.fillColor('#c62828').font('LatinBold').fontSize(10).text(fmt(summary.periodEndBalance), 397, y + 27, { width: 163, align: 'center' });
  document.fillColor('#111111').font('ArabicBold').fontSize(8);
  arabic(document, brand.statementFooter, 80, 774, { width: 435, align: 'center' });
  drawPageNumber(document);
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

function drawBrandedHeader(
  document: PDFKit.PDFDocument,
  customer: StatementPdfCustomer,
  options: StatementPdfOptions,
) {
  const brand = resolveBranding(customer.organization.name, customer.organization.systemSettings);
  document.roundedRect(18, 22, 559, 104, 9).lineWidth(1.5).stroke('#111111');
  document.font('LatinBold').fontSize(8).fillColor('#111111');
  document.text('Al-Bena Al-Raqi For Gen. Trading', 28, 28, { width: 205, align: 'left' });
  document.font('Latin').fontSize(6.8);
  document.text('Reinforcement Steel - Building Materials\n& Electricity Sanitary Wares\nSana’a - Yemen', 28, 43, { width: 205, align: 'left' });
  document.font('ArabicBold').fontSize(9);
  arabic(document, brand.name, 365, 29, { width: 198, align: 'right' });
  document.font('Arabic').fontSize(7);
  arabic(document, [brand.subtitle, brand.address].filter(Boolean).join('\n'), 365, 46, { width: 198, align: 'right' });
  if (brand.phone) document.font('Latin').fontSize(7).text(brand.phone, 365, 91, { width: 198, align: 'right' });
  if (!drawConfiguredLogo(document, customer, 260, 29, 72, 38)) drawBrandMark(document, 276, 30);
  document.font('ArabicBold').fontSize(9);
  arabic(document, brand.name, 240, 67, { width: 115, align: 'center' });
  document.font('ArabicBold').fontSize(9.5);
  arabic(document, `${brand.statementTitle} تحليلي قبل الترحيل - رصيد بعد كل عملية`, 145, 78, {
    width: 305, height: 25, align: 'center',
  });
  const from = options.fromDate ? dateText(options.fromDate) : 'البداية';
  const to = options.toDate ? dateText(options.toDate) : dateText(new Date());
  document.font('ArabicBold').fontSize(8);
  arabic(document, 'من تاريخ', 348, 105, { width: 72, height: 14, align: 'right' });
  boldText(document, from, 268, 105, { width: 78, height: 14, align: 'center' });
  document.font('ArabicBold');
  arabic(document, 'إلى تاريخ', 194, 105, { width: 72, height: 14, align: 'right' });
  document.font('LatinBold').text(to, 114, 105, { width: 78, height: 14, align: 'center' });

  document.font('ArabicBold').fontSize(8.5);
  arabic(document, 'رقم الحساب', 470, 134, { width: 93, align: 'right' });
  document.font('LatinBold').text(customer.externalCustomerCode, 375, 134, { width: 91, align: 'right' });
  document.font('ArabicBold');
  arabic(document, `الحساب التحليلي     ${customer.name}`, 285, 152, { width: 278, align: 'right' });
  arabic(document, 'العملة', 142, 152, { width: 65, align: 'left' });
  document.font('LatinBold').text(options.currency, 27, 152, { width: 110, align: 'left' });
}

const BRAND_COLUMNS = [18, 67, 143, 183, 299, 430, 480, 529];
const BRAND_WIDTHS = [49, 76, 40, 116, 131, 50, 49, 48];
const BRAND_HEADERS = ['التاريخ', 'نوع المستند', 'رقم المستند', 'رقم المرجع', 'البيان', 'مدين', 'دائن', 'الرصيد'];

function drawBrandedTableHeader(document: PDFKit.PDFDocument, y: number) {
  document.rect(18, y, 559, 31).fillAndStroke('#c6e2f7', '#111111');
  document.font('ArabicBold').fontSize(7).fillColor('#111111');
  BRAND_HEADERS.forEach((label, index) => {
    arabic(document, label, BRAND_COLUMNS[index] + 2, y + 9, { width: BRAND_WIDTHS[index] - 4, align: 'center' });
    if (index > 0) document.moveTo(BRAND_COLUMNS[index], y).lineTo(BRAND_COLUMNS[index], y + 31).lineWidth(0.5).stroke('#111111');
  });
  return y + 31;
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
  let y = drawBrandedTableHeader(document, 176);
  let debitTotal = 0;
  let creditTotal = 0;
  for (const row of rows) {
    if (y > 720) {
      document.addPage();
      drawBrandedHeader(document, customer, options);
      y = drawBrandedTableHeader(document, 176);
    }
    document.font('Arabic').fontSize(6.4);
    const height = Math.min(40, Math.max(20, document.heightOfString(row.description || '-', { width: BRAND_WIDTHS[4] - 6 }) + 7));
    debitTotal += row.debit;
    creditTotal += row.credit;
    const values = [dateText(row.date), row.documentType || '-', row.documentNumber || '-', row.reference || '-', row.description || '-', row.debit ? fmt(row.debit) : '', row.credit ? fmt(row.credit) : '', fmt(row.runningBalance)];
    document.rect(18, y, 559, height).lineWidth(0.35).stroke('#333333');
    document.font('Arabic').fontSize(6.4).fillColor('#111111');
    values.forEach((value, index) => {
      if (index > 0) document.moveTo(BRAND_COLUMNS[index], y).lineTo(BRAND_COLUMNS[index], y + height).stroke('#333333');
      tableText(document, value, BRAND_COLUMNS[index] + 2, y + 4, {
        width: BRAND_WIDTHS[index] - 4,
        height: height - 6,
        ellipsis: index !== 4,
        align: index === 4 ? 'right' : 'center',
      });
    });
    y += height;
  }
  if (y > 672) {
    document.addPage();
    drawBrandedHeader(document, customer, options);
    y = drawBrandedTableHeader(document, 176);
  }
  document.font('ArabicBold').fontSize(8).fillColor('#8b0000');
  arabic(document, 'إجمالي العمليات', 300, y + 5, { width: 125, align: 'right' });
  document.font('LatinBold').text(`${rows.length} ${options.currency}`, 230, y + 5, { width: 68, align: 'right' });
  document.text(fmt(debitTotal), 430, y + 5, { width: 50, align: 'center' });
  document.text(fmt(creditTotal), 480, y + 5, { width: 49, align: 'center' });
  document.moveTo(18, y).lineTo(577, y).lineWidth(0.7).stroke('#111111');
  document.moveTo(18, y + 22).lineTo(577, y + 22).stroke('#111111');
  document.fillColor('#111111').font('ArabicBold').fontSize(8.5);
  arabic(document, `إجمالي الرصيد ${summary.periodEndBalance >= 0 ? 'عليكم' : 'لكم'}`, 445, y + 30, { width: 120, align: 'right' });
  document.fillColor('#8b0000').font('LatinBold').text(fmt(Math.abs(summary.periodEndBalance)), 320, y + 29, { width: 120, align: 'center' });
  document.fillColor('#111111').font('ArabicBold').fontSize(7.5);
  arabic(document, brand.statementFooter, 45, y + 55, { width: 520, align: 'right' });
  const sigY = Math.min(y + 82, 760);
  ['المحاسب', 'المراجع', 'المدير المالي', 'المدير العام'].forEach((label, index) => {
    const x = 25 + index * 137;
    arabic(document, label, x, sigY, { width: 110, align: 'center' });
    document.moveTo(x + 8, sigY + 24).lineTo(x + 102, sigY + 24).lineWidth(0.4).stroke('#111111');
  });
  drawPageNumber(document);
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
