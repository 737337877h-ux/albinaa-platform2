import ExcelJS from 'exceljs';

const CURRENCY_MAP: Record<string, string> = {
  YR: 'YER', YER: 'YER', SR: 'SAR', SAR: 'SAR', '$': 'USD', USD: 'USD',
};

export interface EmployeeStatementMovement {
  accountNumber: string;
  accountName: string;
  personName: string;
  employeeNumber: string;
  currencyCode: string;
  date: string;
  documentType: string;
  documentNumber: string;
  description: string;
  reference: string;
  debit: number;
  credit: number;
  sourceRowNumber: number;
  sourceMainAccount: string;
  isOpening: boolean;
}

export interface EmployeeStatementAccountPreview {
  accountNumber: string;
  accountName: string;
  currencyCode: string;
  sourceMainAccounts: string[];
  openingBalance: number;
  movements: number;
  computedBalance: number;
}

export interface EmployeeStatementParseResult {
  movements: EmployeeStatementMovement[];
  accounts: EmployeeStatementAccountPreview[];
  mainAccountsIgnored: string[];
  errors: { rowNumber: number; message: string }[];
  warnings: { rowNumber: number; message: string }[];
  rowsRead: number;
}

interface Block {
  startRow: number;
  mainAccount: string;
  analyticalAccount: string;
  name: string;
  currency: string;
  openingDebit: number;
  openingCredit: number;
  openingRow: number;
  txns: Omit<EmployeeStatementMovement, 'accountNumber' | 'accountName' | 'personName' | 'employeeNumber' | 'currencyCode' | 'sourceMainAccount' | 'isOpening'>[];
}

function text(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in value) return String(value.text ?? '').trim();
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '').trim();
  return String(value).trim();
}

function amount(value: ExcelJS.CellValue): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = text(value).replace(/,/g, '');
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: ExcelJS.CellValue): string | null {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000));
  } else {
    const raw = text(value);
    const dmy = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (dmy) {
      const year = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
      date = new Date(Date.UTC(year, Number(dmy[2]) - 1, Number(dmy[1])));
    } else if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      date = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
    }
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function reportDateFromName(fileName: string): string {
  const match = fileName.match(/(\d{2})[-_](\d{2})[-_](\d{4})/);
  if (!match) return new Date().toISOString().slice(0, 10);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function previousDay(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export async function parseEmployeeStatementWorkbook(
  buffer: Buffer,
  fileName: string,
): Promise<EmployeeStatementParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('ملف Excel لا يحتوي على ورقة عمل');

  const blocks: Block[] = [];
  const errors: { rowNumber: number; message: string }[] = [];
  const warnings: { rowNumber: number; message: string }[] = [];
  let block: Block | null = null;
  const finish = () => {
    if (!block) return;
    if (!block.analyticalAccount || !block.name || !block.currency) {
      errors.push({ rowNumber: block.startRow, message: 'بيانات الحساب التحليلي أو الاسم أو العملة غير مكتملة' });
    } else {
      blocks.push(block);
    }
    block = null;
  };

  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const a = text(row.getCell(1).value);
    const c = text(row.getCell(3).value);
    const d = text(row.getCell(4).value);
    if (a === 'رقم الحساب') {
      finish();
      block = {
        startRow: rowNumber,
        mainAccount: text(row.getCell(2).value),
        analyticalAccount: '',
        name: '',
        currency: '',
        openingDebit: 0,
        openingCredit: 0,
        openingRow: rowNumber,
        txns: [],
      };
      continue;
    }
    if (!block) continue;
    if (a === 'الحساب التحليلي') {
      block.analyticalAccount = text(row.getCell(2).value);
      block.name = d;
      continue;
    }
    if (a === 'العملة') {
      const rawCurrency = c.toUpperCase();
      block.currency = CURRENCY_MAP[rawCurrency] ?? rawCurrency;
      continue;
    }
    if (d.includes('الرصيد الإفتتاحي') || d.includes('الرصيد الافتتاحي')) {
      block.openingDebit = amount(row.getCell(6).value);
      block.openingCredit = amount(row.getCell(7).value);
      block.openingRow = rowNumber;
      continue;
    }
    const date = isoDate(row.getCell(1).value);
    if (!date) continue;
    const debit = amount(row.getCell(6).value);
    const credit = amount(row.getCell(7).value);
    if (!debit && !credit && !text(row.getCell(2).value) && !d) continue;
    block.txns.push({
      date,
      documentType: text(row.getCell(2).value),
      documentNumber: c,
      description: d,
      reference: text(row.getCell(5).value),
      debit,
      credit,
      sourceRowNumber: rowNumber,
    });
  }
  finish();

  const grouped = new Map<string, { blocks: Block[]; openingDebit: number; openingCredit: number }>();
  for (const current of blocks) {
    const key = `${current.analyticalAccount}|${current.currency}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { blocks: [current], openingDebit: current.openingDebit, openingCredit: current.openingCredit });
      continue;
    }
    existing.blocks.push(current);
    if (
      Math.abs(existing.openingDebit - current.openingDebit) > 0.01
      || Math.abs(existing.openingCredit - current.openingCredit) > 0.01
    ) {
      warnings.push({
        rowNumber: current.openingRow,
        message: `تكرر الحساب ${current.analyticalAccount}/${current.currency} برصيد افتتاحي مختلف؛ اعتمد أول رصيد فقط`,
      });
    }
  }

  const fallbackDate = reportDateFromName(fileName);
  const movements: EmployeeStatementMovement[] = [];
  const accounts: EmployeeStatementAccountPreview[] = [];
  for (const value of grouped.values()) {
    const first = value.blocks[0];
    const txns = value.blocks.flatMap((item) => item.txns);
    const uniqueTxns = new Map<string, (typeof txns)[number]>();
    for (const txn of txns) {
      const key = [txn.date, txn.documentType, txn.documentNumber, txn.description, txn.reference, txn.debit, txn.credit, txn.sourceRowNumber].join('|');
      uniqueTxns.set(key, txn);
    }
    const rows = [...uniqueTxns.values()].sort((left, right) => left.date.localeCompare(right.date) || left.sourceRowNumber - right.sourceRowNumber);
    const openingBalance = value.openingDebit - value.openingCredit;
    if (Math.abs(openingBalance) > 0.0001) {
      const openingDate = rows.length ? previousDay(rows[0].date) : fallbackDate;
      movements.push({
        accountNumber: first.analyticalAccount,
        accountName: first.name,
        personName: first.name,
        employeeNumber: first.analyticalAccount,
        currencyCode: first.currency,
        date: openingDate,
        documentType: 'رصيد افتتاحي',
        documentNumber: '',
        description: 'الرصيد الافتتاحي من كشف السلف والعهد',
        reference: '',
        debit: value.openingDebit,
        credit: value.openingCredit,
        sourceRowNumber: first.openingRow,
        sourceMainAccount: first.mainAccount,
        isOpening: true,
      });
    }
    for (const txn of rows) {
      movements.push({
        ...txn,
        accountNumber: first.analyticalAccount,
        accountName: first.name,
        personName: first.name,
        employeeNumber: first.analyticalAccount,
        currencyCode: first.currency,
        sourceMainAccount: first.mainAccount,
        isOpening: false,
      });
    }
    const movementNet = rows.reduce((sum, txn) => sum + txn.debit - txn.credit, 0);
    accounts.push({
      accountNumber: first.analyticalAccount,
      accountName: first.name,
      currencyCode: first.currency,
      sourceMainAccounts: [...new Set(value.blocks.map((item) => item.mainAccount).filter(Boolean))],
      openingBalance,
      movements: rows.length,
      computedBalance: openingBalance + movementNet,
    });
  }

  return {
    movements,
    accounts: accounts.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber) || a.currencyCode.localeCompare(b.currencyCode)),
    mainAccountsIgnored: [...new Set(blocks.map((item) => item.mainAccount).filter(Boolean))],
    errors,
    warnings,
    rowsRead: sheet.rowCount,
  };
}
