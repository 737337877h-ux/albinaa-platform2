# -*- coding: utf-8 -*-
"""
اختبارات محللات ملفات الاستيراد (APMS v1.2.0 — PR 2).
تشغيل:  python -m unittest test_import_profiles -v
أو:     python test_import_profiles.py
"""
import os
import tempfile
import unittest

from openpyxl import Workbook

from import_profiles import (
    PROFILE_STATEMENT, PROFILE_MASTER, PROFILE_BALANCE,
    PROFILE_AGING_SUMMARY, PROFILE_AGING_DETAILS,
    CURRENCY_MAP, decode_xls_text, detect_profile, parse_profile, read_table,
)


def make_xlsx(path, rows):
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(list(r))
    wb.save(path)


def make_tsv(path, rows, encoding='cp1256'):
    text = '\n'.join('\t'.join('' if v is None else str(v) for v in r) for r in rows)
    with open(path, 'wb') as f:
        f.write(text.encode(encoding))


class DetectTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='albinaa_test_')

    def path(self, name):
        return os.path.join(self.dir, name)

    def test_statement_block_xlsx(self):
        p = self.path('statement.xlsx')
        make_xlsx(p, [
            ['رقم العميل', 90001, None, 'عميل الاختبار', None, None, None],
            [None, 0],
            ['العملة', None, 'YR', 'ريال يمني', None, None, None],
            ['التاريخ', 'نوع المستند', 'رقم المستند', 'البيان', 'رقم المرجع', 'مدين', 'دائن'],
            ['2026-02-01', 'فاتورة المبيعات آجل', 101, 'فاتورة', None, 5000, 0],
            [None, None, None, 'إجمالي العمليات', None, 5000, 0],
        ])
        rows, fmt = read_table(p)
        self.assertEqual(fmt, 'xlsx')
        self.assertEqual(detect_profile(rows), PROFILE_STATEMENT)

    def test_master_xlsx(self):
        p = self.path('master.xlsx')
        make_xlsx(p, [
            ['رقم العميل', 'اسم العميل', 'رقم الجوال', 'المنطقة', 'نوع العميل'],
            [1001, 'مؤسسة البناء الحديث', '770000001', 'صنعاء', 'مؤسسة'],
            [1002, 'شركة النور التجارية', '770000002', 'عدن', 'شركة'],
            [None, 'بدون كود', '770000003', '', ''],
            [1001, 'كود مكرر', '770000009', '', ''],
        ])
        rows, fmt = read_table(p)
        self.assertEqual(fmt, 'xlsx')
        self.assertEqual(detect_profile(rows), PROFILE_MASTER)
        res = parse_profile(rows, PROFILE_MASTER)
        self.assertEqual(res['stats']['validRows'], 2)
        self.assertEqual(res['stats']['errors'], 2)
        self.assertEqual(res['customers'][0]['customerCode'], '1001')
        self.assertEqual(res['customers'][0]['region'], 'صنعاء')
        msgs = ' | '.join(e['message'] for e in res['errors'])
        self.assertIn('كود مكرر', msgs)
        self.assertIn('كود عميل ناقص', msgs)

    def test_balance_tsv_cp1256(self):
        p = self.path('balance.xls')
        make_tsv(p, [
            ['رقم العميل', 'اسم العميل', 'العملة', 'الرصيد الحالي'],
            [2001, 'محل الأمانة', 'YR', '15000.50'],
            [2002, 'معرض السلام', 'SR', '8000'],
            [2003, 'مؤسسة غياب الرصيد', 'YR', 'not-a-number'],
        ])
        rows, fmt = read_table(p)
        self.assertEqual(fmt, 'tsv')
        self.assertEqual(detect_profile(rows), PROFILE_BALANCE)
        res = parse_profile(rows, PROFILE_BALANCE)
        self.assertEqual(res['stats']['validRows'], 2)
        self.assertEqual(res['stats']['errors'], 1)
        self.assertEqual(res['balances'][0]['currency'], 'YER')
        self.assertEqual(res['balances'][0]['balance'], 15000.5)
        self.assertEqual(res['balances'][1]['currency'], 'SAR')

    def test_balance_arabic_digits(self):
        p = self.path('balance_ar.xls')
        make_tsv(p, [
            ['رقم العميل', 'اسم العميل', 'العملة', 'الرصيد'],
            ['٣٠٠١', 'عميل بأرقام عربية', 'YR', '١٢٠٠٠'],
        ], encoding='utf-8-sig')
        rows, _ = read_table(p)
        self.assertEqual(detect_profile(rows), PROFILE_BALANCE)
        res = parse_profile(rows, PROFILE_BALANCE)
        self.assertEqual(res['balances'][0]['customerCode'], '3001')
        self.assertEqual(res['balances'][0]['balance'], 12000.0)

    def test_aging_details_tsv(self):
        p = self.path('aging_details.xls')
        make_tsv(p, [
            ['رقم العميل', 'اسم العميل', 'العملة', '0-30', '31-60', '61-90', 'أكثر من 120', 'الإجمالي'],
            [4001, 'محل الأحمد', 'YR', '1000', '2000', '0', '15000', '18000'],
            [4002, 'مؤسسة الواحة', 'SR', '0', '500', '500', '0', '1000'],
        ])
        rows, fmt = read_table(p)
        self.assertEqual(fmt, 'tsv')
        self.assertEqual(detect_profile(rows), PROFILE_AGING_DETAILS)
        res = parse_profile(rows, PROFILE_AGING_DETAILS)
        self.assertEqual(res['stats']['validRows'], 2)
        row = res['agingDetails'][0]
        self.assertEqual(row['customerCode'], '4001')
        self.assertEqual(row['buckets'], {'0-30': 1000.0, '31-60': 2000.0,
                                          '61-90': 0.0, '120+': 15000.0})
        self.assertEqual(row['total'], 18000.0)

    def test_aging_summary_xlsx(self):
        p = self.path('aging_summary.xlsx')
        make_xlsx(p, [
            ['العملة', 'من 0 إلى 30', '31-60', 'أكثر من 120', 'الإجمالي'],
            ['YER', '100000', '50000', '300000', '450000'],
            ['SAR', '20000', '10000', '80000', '110000'],
        ])
        rows, fmt = read_table(p)
        self.assertEqual(fmt, 'xlsx')
        self.assertEqual(detect_profile(rows), PROFILE_AGING_SUMMARY)
        res = parse_profile(rows, PROFILE_AGING_SUMMARY)
        self.assertEqual(res['stats']['validRows'], 2)
        row = res['agingSummary'][0]
        self.assertEqual(row['currency'], 'YER')
        self.assertEqual(row['buckets'], {'0-30': 100000.0, '31-60': 50000.0,
                                          '120+': 300000.0})

    def test_aging_invalid_bucket_reported(self):
        p = self.path('aging_bad.xls')
        make_tsv(p, [
            ['رقم العميل', 'اسم العميل', 'العملة', '0-30', 'أكثر من 120'],
            [5001, 'عميل اختبار', 'YR', 'abc', '100'],
        ])
        rows, _ = read_table(p)
        res = parse_profile(rows, PROFILE_AGING_DETAILS)
        self.assertEqual(res['stats']['validRows'], 1)
        self.assertEqual(res['agingDetails'][0]['buckets']['0-30'], 0.0)
        self.assertIn('غير رقمية', res['errors'][0]['message'])

    def test_unknown_currency_passthrough(self):
        p = self.path('balance_xx.xls')
        make_tsv(p, [
            ['رقم العميل', 'اسم العميل', 'العملة', 'الرصيد'],
            [6001, 'عميل بعملة مجهولة', 'XX', '100'],
        ])
        rows, _ = read_table(p)
        res = parse_profile(rows, PROFILE_BALANCE)
        self.assertEqual(res['balances'][0]['currency'], 'XX')
        self.assertIn('XX', res['balances'][0]['currencyRaw'])

    def test_currency_map(self):
        self.assertEqual(CURRENCY_MAP['YR'], 'YER')
        self.assertEqual(CURRENCY_MAP['SR'], 'SAR')
        self.assertEqual(CURRENCY_MAP['$'], 'USD')

    def test_cp1256_decode_failure_is_clear(self):
        # بايتات لا تمثل نصًا صالحًا بـ CP1256 (0x81 محجوز في CP1256)
        p = self.path('bad.xls')
        with open(p, 'wb') as f:
            f.write(b'name\x81\x00\xff')
        with self.assertRaises(ValueError) as ctx:
            decode_xls_text(p)
        self.assertIn('CP1256', str(ctx.exception))

    def test_ole2_xls_rejected(self):
        p = self.path('legacy.xls')
        with open(p, 'wb') as f:
            f.write(b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' + b'\x00' * 16)
        with self.assertRaises(ValueError) as ctx:
            read_table(p)
        self.assertIn('OLE2', str(ctx.exception))

    def test_unsupported_extension(self):
        p = self.path('data.csv')
        make_tsv(p, [['رقم العميل', 'اسم العميل']], encoding='utf-8')
        with self.assertRaises(ValueError) as ctx:
            read_table(p)
        self.assertIn('غير مدعومة', str(ctx.exception))

    def test_utf8_bom_tsv(self):
        p = self.path('master_utf8.xls')
        make_tsv(p, [
            ['رقم العميل', 'اسم العميل'],
            [7001, 'مؤسسة مخصصة'],
        ], encoding='utf-8-sig')
        rows, fmt = read_table(p)
        self.assertEqual(fmt, 'tsv')
        self.assertEqual(detect_profile(rows), PROFILE_MASTER)
        res = parse_profile(rows, PROFILE_MASTER)
        self.assertEqual(res['customers'][0]['customerName'], 'مؤسسة مخصصة')

    def test_master_missing_header_fails(self):
        p = self.path('no_header.xlsx')
        make_xlsx(p, [
            [1001, 'اسم فقط', '770000001'],
            [1002, 'اسم آخر', '770000002'],
        ])
        rows, _ = read_table(p)
        with self.assertRaises(ValueError) as ctx:
            parse_profile(rows, PROFILE_MASTER)
        self.assertIn('بدون ترويسة', str(ctx.exception))

    def test_empty_rows_skipped(self):
        p = self.path('master_blanks.xlsx')
        make_xlsx(p, [
            ['رقم العميل', 'اسم العميل'],
            [8001, 'عميل أول'],
            [None, None],
            [None, None, None],
            [8002, 'عميل ثانٍ'],
        ])
        rows, _ = read_table(p)
        res = parse_profile(rows, PROFILE_MASTER)
        self.assertEqual(res['stats']['validRows'], 2)
        self.assertEqual(res['stats']['emptyRowsSkipped'], 2)

    def test_master_repeated_labels_tsv(self):
        # تصدير الطباعة: تسميات مكررة كبادئة + قيم بترتيب ثابت
        p = self.path('master_repeated.xls')
        labels = ['اسم العميل', 'رقم الحساب', 'المجموعة', 'المدينه',
                  'رقم التلفون', 'توقيف', 'تاريخ التعامل', 'رقم العميل']
        make_tsv(p, [
            labels + ['10001', 'العميل الأول', '112101001', '1', '', '', '', ''],
            labels + ['10002', 'محلات محسن البده', '112101001', '3', 'صنعاء', '770000001', '', '01/01/2026'],
            labels + ['10001', 'كود مكرر', '112101001', '1', '', '', '', ''],
            labels + ['', 'بدون كود', '112101001', '1', '', '', '', ''],
        ])
        rows, fmt = read_table(p)
        self.assertEqual(fmt, 'tsv')
        self.assertEqual(detect_profile(rows), PROFILE_MASTER)
        res = parse_profile(rows, PROFILE_MASTER)
        self.assertEqual(res['stats']['validRows'], 2)
        self.assertEqual(res['stats']['errors'], 2)
        self.assertEqual(res['customers'][0]['customerCode'], '10001')
        self.assertEqual(res['customers'][1]['phone'], '770000001')
        self.assertEqual(res['customers'][1]['region'], 'صنعاء')
        msgs = ' | '.join(e['message'] for e in res['errors'])
        self.assertIn('كود مكرر', msgs)
        self.assertIn('كود عميل ناقص', msgs)

    def test_aging_summary_repeated_labels_tsv(self):
        # تصدير الطباعة للملخص: تسميات متكررة + قيم الأعمار بترتيب ثابت
        p = self.path('aging_summary_repeated.xls')
        labels = ['إجمالي المبلغ المستحق', 'رقم العميل', 'اسم العميل', 'العملة',
                  'المبلغ', '0 - 30', '31 - 60', '61 - 90', '91 - 120', '> 120']
        make_tsv(p, [
            labels + ['20154', 'خليل محمد صالح عثمان', '$', '800.00', '', '', '', '800.00', '', 'الإجمالي :', '125363834.72'],
            labels + ['10002', 'محلات محسن البده', 'SR', '4454.21', '', '', '', '', '4454.21', 'الإجمالي :', '161943.30'],
        ])
        rows, fmt = read_table(p)
        self.assertEqual(fmt, 'tsv')
        self.assertEqual(detect_profile(rows), PROFILE_AGING_SUMMARY)
        res = parse_profile(rows, PROFILE_AGING_SUMMARY)
        self.assertEqual(res['stats']['validRows'], 2)
        self.assertEqual(res['stats']['errors'], 0)
        row = res['agingSummary'][0]
        self.assertEqual(row['customerCode'], '20154')
        self.assertEqual(row['currency'], 'USD')
        self.assertEqual(row['buckets'], {'0-30': 0.0, '31-60': 0.0, '61-90': 0.0,
                                          '91-120': 800.0, '120+': 0.0})
        self.assertEqual(res['agingSummary'][1]['currency'], 'SAR')

    def test_aging_details_block_tsv(self):
        # بنية الكتل: رأس (عملية/رصيد/عميل) + وثائق بقيمتها في فئتها العمرية
        p = self.path('aging_details_block.xls')
        make_tsv(p, [
            ['العملة : $', 'الرصيد : ', '0.00', 'رقم العميل : 20154 خليل محمد صالح عثمان',
             'إجمالي المبلغ', 'رقم الوثيقة', 'تاريخ الوثيقة', 'نوع الوثيقة', 'المبلغ',
             '0 - 30', '31 - 60', '61 - 90', '91 - 120', '> 120', 'الإجمالي :', '125363834.72'],
            ['0', '01/01/2026', 'الرصيد الإفتتاحي', '0.00', '', '', '', '', '0.00', '0.00',
             'الإجمالي :', '125363834.72'],
            ['4254', '22/07/2026', 'فاتورة المبيعات آجل', '214.30', '214.30', '', '', '', '', '0.00',
             'الإجمالي :', '125363834.72'],
            ['العملة : SR', 'الرصيد : ', '4454.21', 'رقم العميل : 10002 محلات محسن البده',
             'إجمالي المبلغ', 'رقم الوثيقة', 'تاريخ الوثيقة', 'نوع الوثيقة', 'المبلغ',
             '0 - 30', '31 - 60', '61 - 90', '91 - 120', '> 120', 'الإجمالي :', '125363834.72'],
            ['0', '01/01/2026', 'الرصيد الإفتتاحي', '4454.21', '', '', '', '', '4454.21', '0.00',
             'الإجمالي :', '125363834.72'],
        ])
        rows, fmt = read_table(p)
        self.assertEqual(fmt, 'tsv')
        self.assertEqual(detect_profile(rows), PROFILE_AGING_DETAILS)
        res = parse_profile(rows, PROFILE_AGING_DETAILS)
        self.assertEqual(res['stats']['validRows'], 3)
        self.assertEqual(res['stats']['errors'], 0)
        self.assertEqual(res['agingDetails'][0]['customerCode'], '20154')
        self.assertEqual(res['agingDetails'][0]['currency'], 'USD')
        self.assertEqual(res['agingDetails'][0]['buckets'], {'0-30': 0.0, '31-60': 0.0,
                                                             '61-90': 0.0, '91-120': 0.0, '120+': 0.0})
        self.assertEqual(res['agingDetails'][1]['buckets']['0-30'], 214.3)
        self.assertEqual(res['agingDetails'][2]['customerName'], 'محلات محسن البده')
        self.assertEqual(res['agingDetails'][2]['currency'], 'SAR')
        self.assertEqual(res['agingDetails'][2]['buckets']['120+'], 4454.21)


if __name__ == '__main__':
    unittest.main()
