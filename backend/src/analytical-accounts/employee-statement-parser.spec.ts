import ExcelJS from 'exceljs';
import { parseEmployeeStatementWorkbook } from './employee-statement-parser';

describe('parseEmployeeStatementWorkbook', () => {
  it('uses the analytical number and ignores the source main account', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['رقم الحساب', 113101001, '', 'مدينون متنوعون']);
    sheet.addRow(['الحساب التحليلي', 10001, '', 'محمد أحمد']);
    sheet.addRow(['العملة', '', 'YR', 'ريال يمني']);
    sheet.addRow(['التاريخ', 'نوع المستند', 'رقم المستند', 'البيان', 'المرجع', 'مدين', 'دائن']);
    sheet.addRow(['', '', '', 'الرصيد الإفتتاحي', '', 1000, 0]);
    sheet.addRow([new Date('2026-01-02T00:00:00Z'), 'قيد', 7, 'صرف سلفة', '', 500, 0]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const parsed = await parseEmployeeStatementWorkbook(buffer, 'كشف 31-07-2026.xlsx');

    expect(parsed.errors).toEqual([]);
    expect(parsed.mainAccountsIgnored).toEqual(['113101001']);
    expect(parsed.accounts).toEqual([
      expect.objectContaining({ accountNumber: '10001', currencyCode: 'YER', computedBalance: 1500 }),
    ]);
    expect(parsed.movements).toHaveLength(2);
    expect(parsed.movements.every((row) => row.accountNumber === '10001')).toBe(true);
    expect(parsed.movements[0]).toEqual(expect.objectContaining({ date: '2026-01-01', isOpening: true }));
  });
});
