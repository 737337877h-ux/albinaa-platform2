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
  document.text(pdfText(value), x, y, { ...options, features: ['rtla'] });
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
  document.font('ArabicBold').fontSize(14).fillColor('#000000');
  arabic(document, brand.name, 285, 20, { width: 292, align: 'right' });
  document.font('Arabic').fontSize(8);
  arabic(document, brand.subtitle, 285, 43, { width: 292, align: 'right' });

  document.rect(207, 87, 181, 22).lineWidth(0.7).stroke('#000000');
  document.font('ArabicBold').fontSize(10.5);
  arabic(document, brand.statementTitle, 207, 90, {
    width: 181, align: 'center', underline: true,
  });

  const customerBoxX = 277;
  const customerBoxY = 117;
  const customerBoxWidth = 300;
  document.rect(customerBoxX, customerBoxY, customerBoxWidth, 44).lineWidth(0.55).stroke('#000000');
  document.moveTo(customerBoxX, customerBoxY + 22).lineTo(577, customerBoxY + 22).stroke('#000000');
  document.font('ArabicBold').fontSize(7.8);
  arabic(document, 'اسم الحساب', 500, customerBoxY + 6, { width: 69, align: 'right' });
  document.font('ArabicBold').fontSize(7.6);
  arabic(document, customer.name, 286, customerBoxY + 6, { width: 208, height: 12, align: 'right', ellipsis: true });
  document.font('ArabicBold').fontSize(7.8);
  arabic(document, 'رقم الحساب', 500, customerBoxY + 28, { width: 69, align: 'right' });
  document.font('LatinBold').fontSize(8.2).text(customer.externalCustomerCode, 286, customerBoxY + 28, {
    width: 208, height: 12, align: 'right', lineBreak: false,
  });

  const from = options.fromDate ? dateText(options.fromDate) : 'البداية';
  const to = options.toDate ? dateText(options.toDate) : dateText(new Date());
  document.rect(18, 117, 247, 20).lineWidth(0.55).stroke('#000000');
  document.font('ArabicBold').fontSize(7.6);
  arabic(document, 'للفترة من', 194, 122, { width: 63, align: 'right' });
  boldText(document, from, 119, 122, { width: 72, align: 'center' });
  document.font('ArabicBold');
  arabic(document, 'إلى', 93, 122, { width: 24, align: 'center' });
  document.font('LatinBold').text(to, 20, 122, { width: 72, align: 'center' });
  document.rect(61, 141, 204, 20).lineWidth(0.55).stroke('#000000');
  document.font('ArabicBold').fontSize(7.8);
  arabic(document, 'الرصيد الحالي', 181, 146, { width: 76, align: 'right' });
  document.fillColor('#c62828').font('LatinBold').fontSize(9).text(fmt(Math.abs(summary.currentBalance)), 70, 145, {
    width: 106, align: 'right', lineBreak: false,
  });
  document.fillColor('#000000').font('Arabic').fontSize(7.5);
  arabic(document, balanceSide(summary.currentBalance), 18, 146, { width: 38, align: 'center' });
}

const CLASSIC_COLUMNS = [18, 100, 174, 248, 425, 488, 532];
const CLASSIC_WIDTHS = [82, 74, 74, 177, 63, 44, 45];
const CLASSIC_HEADERS = ['الرصيد', 'دائن', 'مدين', 'البيان', 'المرجع', 'المستند', 'التاريخ'];

function drawClassicTableHeader(document: PDFKit.PDFDocument, y: number) {
  document.rect(18, y, 559, 18).lineWidth(0.65).stroke('#000000');
  document.font('ArabicBold').fontSize(7.2).fillColor('#000000');
  CLASSIC_HEADERS.forEach((label, index) => {
    arabic(document, label, CLASSIC_COLUMNS[index] + 2, y + 4, { width: CLASSIC_WIDTHS[index] - 4, align: 'center' });
    if (index > 0) document.moveTo(CLASSIC_COLUMNS[index], y).lineTo(CLASSIC_COLUMNS[index], y + 18).stroke('#000000');
  });
  return y + 18;
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
  arabic(document, balanceSide(value), x + 2, y + 4, { width: 23, height: height - 5, align: 'left', lineBreak: false });
  document.font('Latin').fontSize(6.6).text(fmt(Math.abs(value)), x + 26, y + 4, {
    width: width - 29, height: height - 5, align: 'right', lineBreak: false,
  });
}

function drawClassicRow(
  document: PDFKit.PDFDocument,
  values: string[],
  balance: number,
  y: number,
  height = 16,
) {
  document.fillColor('#000000').fontSize(6.6);
  values.forEach((value, index) => {
    if (index === 0) drawClassicBalanceCell(document, balance, CLASSIC_COLUMNS[index], y, CLASSIC_WIDTHS[index], height);
    else tableText(document, value, CLASSIC_COLUMNS[index] + 3, y + 4, {
      width: CLASSIC_WIDTHS[index] - 6,
      height: height - 5,
      ellipsis: index !== 3,
      align: index >= 4 ? 'right' : 'right',
      lineBreak: false,
    });
    if (index > 0) document.moveTo(CLASSIC_COLUMNS[index], y).lineTo(CLASSIC_COLUMNS[index], y + height).lineWidth(0.35).stroke('#000000');
  });
  document.save().dash(3, { space: 2 }).moveTo(18, y + height).lineTo(577, y + height)
    .lineWidth(0.35).stroke('#000000').undash().restore();
  document.moveTo(18, y).lineTo(18, y + height).lineWidth(0.35).stroke('#000000');
  document.moveTo(577, y).lineTo(577, y + height).lineWidth(0.35).stroke('#000000');
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
    arabic(document, legalText, 70, 770, { width: 507, height: 13, align: 'right', lineBreak: false, ellipsis: true });
    document.moveTo(18, 793).lineTo(577, 793).lineWidth(0.4).stroke('#000000');
    document.font('Latin').fontSize(6.2).text(`Page :${index + 1}`, 18, 803, {
      width: 80, height: 10, align: 'left', lineBreak: false,
    });
    document.font('Latin').text(`Prepared by: ${printedBy} / ${dateTimeText(printedAt)}`, 292, 803, {
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
  let y = drawClassicTableHeader(document, 165);
  let debitTotal = 0;
  let creditTotal = 0;
  const openingDate = options.fromDate ?? (rows[0]?.date ?? new Date());
  y = drawClassicRow(document, [
    '', '', '', 'الرصيد الافتتاحي', '', '', dateText(openingDate),
  ], summary.periodStartBalance, y);
  for (const row of rows) {
    if (y > 735) {
      document.addPage();
      drawClassicHeader(document, customer, summary, options);
      y = drawClassicTableHeader(document, 165);
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
      dateText(row.date),
    ];
    y = drawClassicRow(document, values, row.runningBalance, y);
  }

  if (y > 718) {
    document.addPage();
    drawClassicHeader(document, customer, summary, options);
    y = drawClassicTableHeader(document, 165);
  }
  document.moveTo(18, y).lineTo(577, y).lineWidth(0.65).stroke('#000000');
  document.moveTo(18, y + 2).lineTo(577, y + 2).lineWidth(0.35).stroke('#000000');
  CLASSIC_COLUMNS.slice(1).forEach((x) => document.moveTo(x, y).lineTo(x, y + 19).lineWidth(0.35).stroke('#000000'));
  document.moveTo(18, y).lineTo(18, y + 19).stroke('#000000');
  document.moveTo(577, y).lineTo(577, y + 19).stroke('#000000');
  document.font('ArabicBold').fontSize(7.3);
  arabic(document, 'المجموع الكلي', 251, y + 6, { width: 171, align: 'right' });
  document.font('LatinBold').fontSize(7).text(fmt(debitTotal), 177, y + 6, { width: 68, align: 'right', lineBreak: false });
  document.text(fmt(creditTotal), 103, y + 6, { width: 68, align: 'right', lineBreak: false });
  document.moveTo(18, y + 17).lineTo(577, y + 17).lineWidth(0.35).stroke('#000000');
  document.moveTo(18, y + 19).lineTo(577, y + 19).lineWidth(0.65).stroke('#000000');
  y += 19;

  const endingDate = options.toDate ?? (rows.at(-1)?.date ?? new Date());
  drawClassicRow(document, [
    '', '', '', 'الرصيد النهائي', '', '', dateText(endingDate),
  ], summary.periodEndBalance, y, 18);
  document.moveTo(18, y + 18).lineTo(577, y + 18).lineWidth(0.65).stroke('#000000');
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
