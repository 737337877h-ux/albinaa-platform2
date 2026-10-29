import PDFDocument from 'pdfkit';
import path from 'node:path';
import { brandingLogoBuffer, resolveBranding } from '../common/branding';

interface CurrencyRow {
  currency: string;
  debtTotal: number;
  debtorCount: number;
  reservationTotal: number;
  reservationCount: number;
  aging: null | {
    bucket_0_30: number; bucket_31_60: number; bucket_61_90: number;
    bucket_91_120: number; bucket_120_plus: number; undated: number; totalDue: number;
  };
  kpi: null | { dso: number | null; cei: number | null; averageDebtAge: number | null };
}

export interface ManagementSummaryPdfReport {
  generatedAt: Date;
  accountClass: 'customer' | 'advance';
  byCurrency: CurrencyRow[];
  topDebtors: Array<{ rank: number; currency: string; customerCode: string; customerName: string; balance: number }>;
  activeReservations: Array<{ customerName: string; currency: string; itemName: string; totalAmount: number; status: string }>;
  collectorPerformance: Array<{ collectorName: string; currency: string; dailyAmount: number; monthlyAmount: number; target: number | null; attainment: number | null }>;
}

export interface ManagementSummaryPdfOrganization {
  name: string;
  systemSettings?: Array<{ key: string; value: unknown }>;
}

const PAGE_WIDTH = 595.28;
const LEFT = 28;
const CONTENT_WIDTH = PAGE_WIDTH - LEFT * 2;
const GREEN = '#0f4c3a';
const GOLD = '#c59b27';
const LINE = '#d7dedb';
const TEXT = '#18211f';

function collect(document: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  return new Promise((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });
}

function registerFonts(document: PDFKit.PDFDocument) {
  const fontDir = path.resolve(__dirname, '../../assets/fonts');
  document.registerFont('Arabic', path.join(fontDir, 'NotoSansArabic-Regular.ttf'));
  document.registerFont('ArabicBold', path.join(fontDir, 'NotoSansArabic-Bold.ttf'));
  document.registerFont('Latin', path.join(fontDir, 'NotoSans-Regular.ttf'));
  document.registerFont('LatinBold', path.join(fontDir, 'NotoSans-Bold.ttf'));
}

function arabic(document: PDFKit.PDFDocument, value: string, x: number, y: number, width: number, options: PDFKit.Mixins.TextOptions = {}) {
  document.text(value, x, y, { width, features: ['rtla'], ...options });
}

function money(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateTime(value: Date) {
  return value.toLocaleString('en-GB', {
    timeZone: 'Asia/Aden', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function hasArabic(value: string) {
  return /[\u0600-\u06ff]/.test(value);
}

export async function renderManagementSummaryPdf(
  report: ManagementSummaryPdfReport,
  organization: ManagementSummaryPdfOrganization,
  printedBy: string,
): Promise<Buffer> {
  const brand = resolveBranding(organization.name, organization.systemSettings);
  const document = new PDFDocument({ size: 'A4', margin: LEFT, bufferPages: true, info: { Title: 'التقرير الإداري الشامل' } });
  registerFonts(document);
  const completed = collect(document);
  let y = 0;

  const drawHeader = () => {
    document.fillColor(GREEN).rect(0, 0, PAGE_WIDTH, 78).fill();
    const logo = brandingLogoBuffer(brand.logoDataUrl);
    if (logo) {
      try { document.image(logo, LEFT, 16, { fit: [52, 46] }); } catch { /* keep text-only header */ }
    }
    document.fillColor('#ffffff').font('ArabicBold').fontSize(15);
    arabic(document, brand.name, 315, 14, 252, { align: 'right' });
    document.font('Arabic').fontSize(7.5);
    arabic(document, brand.subtitle || 'إدارة المديونية والتحصيل', 315, 41, 252, { align: 'right' });
    document.fillColor(GOLD).rect(0, 78, PAGE_WIDTH, 4).fill();
    document.fillColor(TEXT).font('ArabicBold').fontSize(13);
    arabic(document, 'التقرير الإداري الشامل', LEFT, 94, CONTENT_WIDTH, { align: 'right' });
    document.font('Arabic').fontSize(7.5).fillColor('#5e6d69');
    const classLabel = report.accountClass === 'advance' ? 'السلف على الغير فقط' : 'العملاء فقط';
    arabic(document, `${classLabel} - العملات مفصولة محاسبيًا`, LEFT, 120, CONTENT_WIDTH, { align: 'right' });
    document.font('Latin').fontSize(7).text(dateTime(report.generatedAt), LEFT, 121, { width: 180, align: 'left' });
    y = 145;
  };

  const ensureSpace = (height: number) => {
    if (y + height <= 785) return;
    document.addPage();
    drawHeader();
  };

  const sectionTitle = (title: string) => {
    ensureSpace(34);
    document.fillColor('#edf4f1').roundedRect(LEFT, y, CONTENT_WIDTH, 25, 5).fill();
    document.fillColor(GREEN).font('ArabicBold').fontSize(9);
    arabic(document, title, LEFT + 8, y + 5, CONTENT_WIDTH - 16, { align: 'right' });
    y += 31;
  };

  const currencySectionTitle = (currency: string) => {
    ensureSpace(34);
    document.fillColor('#edf4f1').roundedRect(LEFT, y, CONTENT_WIDTH, 25, 5).fill();
    document.fillColor(GREEN).font('LatinBold').fontSize(9)
      .text(currency, LEFT + 8, y + 7, { width: 55, align: 'left' });
    document.font('ArabicBold').fontSize(9);
    arabic(document, 'ملخص العملة', LEFT + 70, y + 5, CONTENT_WIDTH - 78, { align: 'right' });
    y += 31;
  };

  const metric = (label: string, value: string, x: number, width: number) => {
    document.lineWidth(0.6).strokeColor(LINE).roundedRect(x, y, width, 48, 5).stroke();
    document.fillColor('#687773').font('Arabic').fontSize(6.6);
    arabic(document, label, x + 7, y + 5, width - 14, { align: 'right' });
    document.fillColor(TEXT).font(hasArabic(value) ? 'ArabicBold' : 'LatinBold').fontSize(10.5);
    if (hasArabic(value)) arabic(document, value, x + 7, y + 21, width - 14, { align: 'right' });
    else document.text(value, x + 7, y + 23, { width: width - 14, align: 'right' });
  };

  const tableHeader = (headers: string[], widths: number[]) => {
    document.fillColor(GREEN).rect(LEFT, y, CONTENT_WIDTH, 23).fill();
    let x = LEFT;
    headers.forEach((header, index) => {
      document.fillColor('#ffffff').font(hasArabic(header) ? 'ArabicBold' : 'LatinBold').fontSize(6.7);
      if (hasArabic(header)) arabic(document, header, x + 3, y + 5, widths[index] - 6, { align: 'center' });
      else document.text(header, x + 3, y + 6, { width: widths[index] - 6, align: 'center' });
      x += widths[index];
    });
    y += 23;
  };

  const tableRow = (values: string[], widths: number[], numeric: number[] = []) => {
    ensureSpace(22);
    let x = LEFT;
    document.strokeColor(LINE).lineWidth(0.45).rect(LEFT, y, CONTENT_WIDTH, 22).stroke();
    values.forEach((value, index) => {
      if (index > 0) document.moveTo(x, y).lineTo(x, y + 22).stroke();
      if (numeric.includes(index)) {
        document.fillColor(TEXT).font('Latin').fontSize(6.8).text(value, x + 3, y + 6, { width: widths[index] - 6, align: 'right', ellipsis: true });
      } else {
        document.fillColor(TEXT).font('Arabic').fontSize(6.7);
        arabic(document, value, x + 3, y + 5, widths[index] - 6, { align: 'right', ellipsis: true, lineBreak: false });
      }
      x += widths[index];
    });
    y += 22;
  };

  drawHeader();
  for (const row of report.byCurrency) {
    currencySectionTitle(row.currency);
    const gap = 7;
    const width = (CONTENT_WIDTH - gap * 3) / 4;
    metric('إجمالي المديونية', `${money(row.debtTotal)} ${row.currency}`, LEFT, width);
    metric('عدد الحسابات المدينة', String(row.debtorCount), LEFT + (width + gap), width);
    metric('أيام التحصيل', row.kpi?.dso == null ? 'غير متاح' : money(row.kpi.dso), LEFT + (width + gap) * 2, width);
    metric('كفاءة التحصيل', row.kpi?.cei == null ? 'بانتظار الإقفال' : `${money(row.kpi.cei)}%`, LEFT + (width + gap) * 3, width);
    y += 56;
    const aging = row.aging;
    tableHeader(['0-30', '31-60', '61-90', '91-120', '+120', 'غير مؤرخ', 'الإجمالي'], [77, 77, 77, 77, 77, 77, 77]);
    tableRow([
      money(aging?.bucket_0_30), money(aging?.bucket_31_60), money(aging?.bucket_61_90),
      money(aging?.bucket_91_120), money(aging?.bucket_120_plus), money(aging?.undated), money(aging?.totalDue),
    ], [77, 77, 77, 77, 77, 77, 77], [0, 1, 2, 3, 4, 5, 6]);
    y += 9;
  }

  sectionTitle('أعلى المدينين - أولوية التواصل');
  const debtorWidths = [42, 64, 72, 225, 136];
  tableHeader(['#', 'العملة', 'الكود', 'العميل', 'الرصيد'], debtorWidths);
  for (const row of report.topDebtors) {
    if (y + 22 > 785) { ensureSpace(22); tableHeader(['#', 'العملة', 'الكود', 'العميل', 'الرصيد'], debtorWidths); }
    tableRow([String(row.rank), row.currency, row.customerCode || '-', row.customerName, money(row.balance)], debtorWidths, [0, 1, 2, 4]);
  }

  sectionTitle('أداء المحصلين');
  const collectorWidths = [170, 60, 103, 103, 103];
  tableHeader(['المحصل', 'العملة', 'اليوم', 'الشهر', 'الإنجاز'], collectorWidths);
  for (const row of report.collectorPerformance) {
    if (y + 22 > 785) { ensureSpace(22); tableHeader(['المحصل', 'العملة', 'اليوم', 'الشهر', 'الإنجاز'], collectorWidths); }
    tableRow([
      row.collectorName, row.currency, money(row.dailyAmount), money(row.monthlyAmount),
      row.attainment == null ? '-' : `${money(row.attainment)}%`,
    ], collectorWidths, [1, 2, 3, 4]);
  }

  if (report.activeReservations.length) {
    sectionTitle('الحجوزات النشطة');
    const reservationWidths = [206, 143, 60, 130];
    tableHeader(['العميل', 'الصنف', 'العملة', 'القيمة'], reservationWidths);
    for (const row of report.activeReservations) {
      if (y + 22 > 785) { ensureSpace(22); tableHeader(['العميل', 'الصنف', 'العملة', 'القيمة'], reservationWidths); }
      tableRow([row.customerName, row.itemName, row.currency, money(row.totalAmount)], reservationWidths, [2, 3]);
    }
  }

  const pages = document.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    document.switchToPage(index);
    document.strokeColor(LINE).moveTo(LEFT, 808).lineTo(PAGE_WIDTH - LEFT, 808).stroke();
    document.fillColor('#63706d').font('Arabic').fontSize(6.5);
    arabic(document, `طبع بواسطة: ${printedBy}`, PAGE_WIDTH - 235, 814, 207, { align: 'right' });
    document.font('Latin').text(`Page ${index + 1} / ${pages.count}`, LEFT, 814, { width: 100, align: 'left' });
  }
  document.end();
  return completed;
}
