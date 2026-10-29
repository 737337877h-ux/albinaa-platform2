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

from albinaa_parser import normalize_text, parse_workbook
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

    def test_master_contacts_collector_and_advance_type(self):
        p = self.path('master_contacts.xlsx')
        make_xlsx(p, [
            ['رقم العميل', 'اسم العميل', 'رقم الحساب التحليلي', 'الهاتف', 'واتساب',
             'المنطقة', 'العنوان', 'نوع الحساب', 'المحصل'],
            ['20001', 'سلفة اختبار', '20001', '+967-700-000-000', '+967-711-111-111',
             'صنعاء', 'شارع الاختبار', 'سلفة على الغير', 'collector.username'],
        ])
        rows, _ = read_table(p)
        self.assertEqual(detect_profile(rows), PROFILE_MASTER)
        parsed = parse_profile(rows, PROFILE_MASTER)['customers'][0]
        self.assertEqual(parsed['accountNumber'], '20001')
        self.assertEqual(parsed['phone'], '+967-700-000-000')
        self.assertEqual(parsed['whatsapp'], '+967-711-111-111')
        self.assertEqual(parsed['customerType'], 'advance')
        self.assertEqual(parsed['collector'], 'collector.username')

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

# ---------------------------------------------------------------------------
# Fix 1 — GL-oriented statement variant (رقم الحساب + الحساب التحليلي)
#
# All fixtures below are synthetic: invented GL codes, customer codes and
# names. No production workbook or real customer data is committed.
# ---------------------------------------------------------------------------
GL_CODE = 999000001
GL_NAME = 'حساب تجريبي أب'


def _gl_block(code, name, ccy='YR', ccy_name='ريال يمني', txns=(),
              opening=(0, 0), gl_code=GL_CODE, gl_name=GL_NAME,
              with_analytic=True, totals=True):
    """One GL-variant block. Row geometry mirrors the real export."""
    rows = [['رقم الحساب', gl_code, None, gl_name, None, None, None]]
    if with_analytic:
        rows.append(['الحساب التحليلي', code, None, name, None, None, None])
    rows.append([None, 0])
    rows.append([None, 0])
    rows.append(['العملة', None, ccy, ccy_name, None, None, None])
    rows.append([None, None, None, None, None, 'المبلغ الأجنبي', 'المبلغ الأجنبي'])
    rows.append(['التاريخ', 'نوع المستند', 'رقم المستند', 'البيان', 'رقم المرجع', 'مدين', 'دائن'])
    od, oc = opening
    rows.append([None, None, None, 'الرصيد الإفتتاحي', None, od, oc])
    for t in txns:
        rows.append(list(t))
    if totals:
        td = sum(t[5] or 0 for t in txns)
        tc = sum(t[6] or 0 for t in txns)
        rows.append([None, None, None, 'إجمالي العمليات', None, td, tc])
        declared = (od + td) - (oc + tc)
        rows.append([None, None, 'إجمالي الرصيد عليكم', 'نص', None, declared, None])
    return rows


def _txn(date, desc, debit=0, credit=0, doc=101):
    return [date, 'فاتورة المبيعات آجل', doc, desc, None, debit, credit]


def make_gl_statement_xlsx(path, blocks):
    rows = [[None] * 7]
    for b in blocks:
        rows.extend(b)
    make_xlsx(path, rows)


class GLStatementVariantTests(unittest.TestCase):
    """رقم الحساب + الحساب التحليلي variant — identity comes from the
    الحساب التحليلي row; the رقم الحساب row is the parent GL account only."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def path(self, name):
        return os.path.join(self.dir, name)

    # -- detection ----------------------------------------------------------
    def test_gl_variant_is_detected_as_statement(self):
        p = self.path('gl.xlsx')
        make_gl_statement_xlsx(p, [
            _gl_block(10001, 'عميل تجريبي أ', txns=[_txn('2026-02-01', 'فاتورة', 5000, 0)]),
        ])
        rows, fmt = read_table(p)
        self.assertEqual(fmt, 'xlsx')
        self.assertEqual(detect_profile(rows), PROFILE_STATEMENT)

    def test_legacy_customer_variant_still_detected(self):
        p = self.path('legacy.xlsx')
        make_xlsx(p, [
            ['رقم العميل', 90001, None, 'عميل الاختبار', None, None, None],
            [None, 0],
            ['العملة', None, 'YR', 'ريال يمني', None, None, None],
            ['التاريخ', 'نوع المستند', 'رقم المستند', 'البيان', 'رقم المرجع', 'مدين', 'دائن'],
            ['2026-02-01', 'فاتورة المبيعات آجل', 101, 'فاتورة', None, 5000, 0],
            [None, None, None, 'إجمالي العمليات', None, 5000, 0],
        ])
        rows, _ = read_table(p)
        self.assertEqual(detect_profile(rows), PROFILE_STATEMENT)

    # -- identity -----------------------------------------------------------
    def test_identity_comes_from_analytic_row(self):
        p = self.path('identity.xlsx')
        make_gl_statement_xlsx(p, [
            _gl_block(10001, 'عميل تجريبي أ', txns=[_txn('2026-02-01', 'فاتورة', 5000, 0)]),
        ])
        res = parse_workbook(p)
        self.assertEqual(len(res.accounts), 1)
        acc = list(res.accounts.values())[0]
        self.assertEqual(int(acc.customer_code), 10001)
        self.assertEqual(normalize_text(acc.customer_name), 'عميل تجريبي أ')

    def test_parent_gl_is_never_customer_identity(self):
        p = self.path('parent.xlsx')
        make_gl_statement_xlsx(p, [
            _gl_block(10001, 'عميل تجريبي أ', txns=[_txn('2026-02-01', 'فاتورة', 5000, 0)]),
        ])
        res = parse_workbook(p)
        codes = [str(c) for (c, _ccy) in res.accounts.keys()]
        names = [normalize_text(a.customer_name) for a in res.accounts.values()]
        self.assertNotIn(str(GL_CODE), codes)
        self.assertNotIn(GL_NAME, names)
        # parent details retained as metadata only
        acc = list(res.accounts.values())[0]
        self.assertEqual(str(acc.parent_account_code), str(GL_CODE))
        self.assertEqual(normalize_text(acc.parent_account_name), GL_NAME)

    def test_three_analytics_under_one_gl_stay_separate(self):
        p = self.path('three.xlsx')
        make_gl_statement_xlsx(p, [
            _gl_block(10001, 'عميل تجريبي أ', txns=[_txn('2026-02-01', 'أ', 1000, 0)]),
            _gl_block(10002, 'عميل تجريبي ب', txns=[_txn('2026-02-02', 'ب', 2000, 0),
                                                     _txn('2026-02-03', 'ب2', 500, 0)]),
            _gl_block(10003, 'عميل تجريبي ج', txns=[_txn('2026-02-04', 'ج', 3000, 0)]),
        ])
        res = parse_workbook(p)
        self.assertEqual(len(res.accounts), 3)
        self.assertEqual([m for _r, m, _raw in res.errors], [])
        by_code = {int(c): a for (c, _ccy), a in res.accounts.items()}
        self.assertEqual(sorted(by_code), [10001, 10002, 10003])
        # the terminator must not let one block swallow the next
        self.assertEqual(len(by_code[10001].transactions), 1)
        self.assertEqual(len(by_code[10002].transactions), 2)
        self.assertEqual(len(by_code[10003].transactions), 1)

    # -- currency -----------------------------------------------------------
    def test_same_customer_two_currencies_one_identity(self):
        p = self.path('ccy.xlsx')
        make_gl_statement_xlsx(p, [
            _gl_block(10001, 'عميل تجريبي أ', ccy='YR',
                      txns=[_txn('2026-02-01', 'يمني', 1000, 0)]),
            _gl_block(10001, 'عميل تجريبي أ', ccy='SR', ccy_name='ريال سعودي',
                      txns=[_txn('2026-02-02', 'سعودي', 200, 0)]),
        ])
        res = parse_workbook(p)
        self.assertEqual(len(res.accounts), 2)
        self.assertEqual([m for _r, m, _raw in res.errors], [])
        currencies = sorted(a.currency for a in res.accounts.values())
        self.assertEqual(currencies, ['SAR', 'YER'])
        names = {normalize_text(a.customer_name) for a in res.accounts.values()}
        codes = {int(a.customer_code) for a in res.accounts.values()}
        self.assertEqual(names, {'عميل تجريبي أ'})
        self.assertEqual(codes, {10001})

    def test_same_code_under_different_gl_same_name_allowed(self):
        p = self.path('gl2.xlsx')
        make_gl_statement_xlsx(p, [
            _gl_block(10001, 'عميل تجريبي أ', txns=[_txn('2026-02-01', 'أ', 1000, 0)]),
            _gl_block(10001, 'عميل تجريبي أ', gl_code=888000002, gl_name='حساب تجريبي جد',
                      txns=[_txn('2026-02-02', 'أ2', 500, 0)]),
        ])
        res = parse_workbook(p)
        self.assertEqual(len(res.accounts), 1)
        self.assertEqual([m for _r, m, _raw in res.errors], [])
        acc = list(res.accounts.values())[0]
        self.assertEqual(int(acc.customer_code), 10001)
        self.assertEqual(len(acc.transactions), 2)

    # -- conflicts ----------------------------------------------------------
    def test_conflicting_names_for_one_code_reports_conflict(self):
        p = self.path('conflict.xlsx')
        make_gl_statement_xlsx(p, [
            _gl_block(10001, 'عميل تجريبي أ', txns=[_txn('2026-02-01', 'أ', 1000, 0)]),
            _gl_block(10001, 'عميل تجريبي مختلف', txns=[_txn('2026-02-02', 'ب', 9999, 0)]),
        ])
        res = parse_workbook(p)
        msgs = ' | '.join(m for _r, m, _raw in res.errors)
        self.assertIn('تعارض', msgs)
        # conflicting block must not be silently merged
        acc = list(res.accounts.values())[0]
        self.assertEqual(normalize_text(acc.customer_name), 'عميل تجريبي أ')
        self.assertEqual(len(acc.transactions), 1)

    def test_missing_analytic_row_reports_block_error(self):
        p = self.path('missing.xlsx')
        make_gl_statement_xlsx(p, [
            _gl_block(10001, 'عميل تجريبي أ', with_analytic=False,
                      txns=[_txn('2026-02-01', 'أ', 1000, 0)]),
            _gl_block(10002, 'عميل تجريبي ب', txns=[_txn('2026-02-02', 'ب', 2000, 0)]),
        ])
        res = parse_workbook(p)
        msgs = ' | '.join(m for _r, m, _raw in res.errors)
        self.assertIn('الحساب التحليلي', msgs)
        # the healthy block must still parse
        self.assertEqual(len(res.accounts), 1)
        acc = list(res.accounts.values())[0]
        self.assertEqual(int(acc.customer_code), 10002)

    # -- reconciliation / idempotency --------------------------------------
    def test_balances_and_transactions_reconcile(self):
        p = self.path('recon.xlsx')
        make_gl_statement_xlsx(p, [
            _gl_block(10001, 'عميل تجريبي أ', opening=(1000, 0), txns=[
                _txn('2026-02-01', 'فاتورة', 5000, 0),
                _txn('2026-02-02', 'سداد', 0, 2000),
            ]),
        ])
        res = parse_workbook(p)
        acc = list(res.accounts.values())[0]
        self.assertAlmostEqual(acc.computed_balance, 4000.0, places=4)
        self.assertAlmostEqual(acc.declared_balance, 4000.0, places=4)
        self.assertEqual(len(acc.transactions), 2)

    def test_line_hash_is_idempotent(self):
        p = self.path('hash.xlsx')
        make_gl_statement_xlsx(p, [
            _gl_block(10001, 'عميل تجريبي أ', txns=[
                _txn('2026-02-01', 'فاتورة', 1000, 0),
                _txn('2026-02-01', 'فاتورة', 1000, 0),
            ]),
        ])
        first = [t.line_hash for a in parse_workbook(p).accounts.values() for t in a.transactions]
        second = [t.line_hash for a in parse_workbook(p).accounts.values() for t in a.transactions]
        self.assertEqual(first, second)
        self.assertEqual(len(set(first)), 2, 'identical rows must get distinct sequenced hashes')

    # -- correct rejections stay rejected -----------------------------------
    def test_unrelated_workbooks_still_rejected(self):
        rules = self.path('rules.xlsx')
        make_xlsx(rules, [
            ['RuleID', 'Category', 'القرار الموصى به', 'الأولوية', 'شرط التفعيل'],
            ['D001', 'Inventory', 'إعادة طلب فوري', 'Critical', 'الكمية منخفضة'],
        ])
        rows, _ = read_table(rules)
        with self.assertRaises(ValueError):
            detect_profile(rows)

        dash = self.path('dash.xlsx')
        make_xlsx(dash, [
            [None, None, None],
            [None, 'نظام متابعة تحصيل', None],
            [None, 'حتى تاريخ 02-07-2026', None],
        ])
        rows, _ = read_table(dash)
        with self.assertRaises(ValueError):
            detect_profile(rows)


class LegacyStatementParityTests(unittest.TestCase):
    """The رقم العميل layout must keep parsing exactly as before."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def _legacy(self):
        p = os.path.join(self.dir, 'legacy.xlsx')
        make_xlsx(p, [
            [None] * 7,
            ['رقم العميل', 90001, None, 'عميل الاختبار', None, None, None],
            [None, 0],
            ['العملة', None, 'YR', 'ريال يمني', None, None, None],
            ['التاريخ', 'نوع المستند', 'رقم المستند', 'البيان', 'رقم المرجع', 'مدين', 'دائن'],
            [None, None, None, 'الرصيد الإفتتاحي', None, 1000, 0],
            ['2026-02-01', 'فاتورة المبيعات آجل', 101, 'فاتورة', None, 5000, 0],
            ['2026-02-02', 'سند قبض', 102, 'سداد', None, 0, 2000],
            [None, None, None, 'إجمالي العمليات', None, 5000, 2000],
            [None, None, 'إجمالي الرصيد عليكم', 'نص', None, 4000, None],
        ])
        return p

    def test_legacy_identity_and_balances_unchanged(self):
        res = parse_workbook(self._legacy())
        self.assertEqual(len(res.accounts), 1)
        acc = list(res.accounts.values())[0]
        self.assertEqual(int(acc.customer_code), 90001)
        self.assertEqual(normalize_text(acc.customer_name), 'عميل الاختبار')
        self.assertEqual(acc.currency, 'YER')
        self.assertAlmostEqual(acc.computed_balance, 4000.0, places=4)
        self.assertAlmostEqual(acc.declared_balance, 4000.0, places=4)
        self.assertEqual(len(acc.transactions), 2)
        self.assertEqual([m for _r, m, _raw in res.errors], [])

    def test_legacy_has_no_parent_gl_metadata(self):
        res = parse_workbook(self._legacy())
        acc = list(res.accounts.values())[0]
        self.assertIsNone(acc.parent_account_code)
        self.assertIsNone(acc.parent_account_name)

    def test_legacy_line_hashes_are_stable(self):
        p = self._legacy()
        a = [t.line_hash for acc in parse_workbook(p).accounts.values() for t in acc.transactions]
        b = [t.line_hash for acc in parse_workbook(p).accounts.values() for t in acc.transactions]
        self.assertEqual(a, b)
        self.assertEqual(len(set(a)), 2)


if __name__ == '__main__':
    unittest.main()
