# -*- coding: utf-8 -*-
"""
يولّد ملف اختبار اصطناعيًا يطابق بنية ملف النظام المحاسبي الحقيقي:
- 3 عملاء، أحدهم بعملتين (YR + SR) لاختبار تعدد العملات.
- كتلة مجزأة لنفس (العميل، العملة) لاختبار الدمج.
- صف تالف (مدين ودائن معًا) وصف بمبلغ سالب — لاختبار تسجيل الخطأ والاستمرار.
- عملة غير معروفة (XX) لاختبار معالجة الأخطاء.
تشغيل: python3 generate_fixture.py  → ينتج fixture.xlsx بجانب السكربت
"""
from openpyxl import Workbook
from datetime import datetime
import os

wb = Workbook()
ws = wb.active
ws.title = 'ورقة1'
r = [None]  # عدّاد صفوف بسيط


def row(*vals):
    ws.append(list(vals) + [None] * (7 - len(vals)))


def header(code, name):
    row('رقم العميل', code, None, name)
    for _ in range(3):
        row(None, 0)


def currency(code_raw, name):
    row('العملة', None, code_raw, name)
    row(None, None, None, None, None, 'المبلغ الأجنبي', 'المبلغ الأجنبي')
    row('التاريخ', 'نوع المستند', 'رقم المستند', 'البيان', 'رقم المرجع', 'مدين', 'دائن')


def opening(d, c):
    row(None, None, None, 'الرصيد الإفتتاحي', None, d, c)


def txn(dt, doctype, num, desc, ref, d, c):
    row(datetime.fromisoformat(dt), doctype, num, desc, ref, d, c)


def totals(ccy, d, c, label=None, val=None):
    row(None, None, ccy, 'إجمالي العمليات', None, d, c)
    if label == 'debit':
        row(None, None, 'إجمالي الرصيد عليكم', 'فقط لا غير', None, val, None)
    elif label == 'credit':
        row(None, None, 'إجمالي الرصيد لكم', 'فقط لا غير', None, None, val)
    elif label == 'zero':
        row(None, None, 'الرصيد الحالي', 'صفر', None, 0, None)


# ===== العميل 90001 — عملتان (YR ثم SR) =====
header(90001, 'عميل الاختبار الأول')
currency('YR', 'ريال يمني')
opening(10000, 0)
txn('2026-02-01', 'فاتورة المبيعات آجل', 101, 'فاتورة اختبار', None, 5000, 0)
txn('2026-02-10', 'سند قبض نقدي', 102, 'دفعة من الحساب', None, 0, 3000)
totals('YR', 5000, 3000, 'debit', 12000)   # 10000+5000-3000 = 12000

header(90001, 'عميل الاختبار الأول')
currency('SR', 'ريال سعودي')
opening(0, 0)
txn('2026-03-01', 'فاتورة المبيعات آجل', 201, 'فاتورة بالسعودي', None, 700, 0)
totals('SR', 700, 0, 'debit', 700)

# ===== العميل 90002 — كتلة مجزأة (جزءان لنفس YR) =====
header(90002, 'عميل الاختبار الثاني')
currency('YR', 'ريال يمني')
opening(0, 2000)
txn('2026-01-15', 'فاتورة المبيعات آجل', 301, 'فاتورة أ', None, 4000, 0)
# لا صف إجمالي — الكتلة تنقطع (محاكاة فاصل صفحات)

header(90002, 'عميل الاختبار الثاني')
currency('YR', 'ريال يمني')
opening(0, 2000)  # الافتتاحي يتكرر بنفس القيمة في الكتل المجزأة
txn('2026-01-20', 'سند قبض نقدي', 302, 'دفعة', None, 0, 1000)
txn('2026-01-20', 'سند قبض نقدي', 302, 'دفعة', None, 0, 1000)  # حركة متطابقة مشروعة (تختبر occ=n)
totals('YR', 4000, 4000, 'zero')            # -2000+4000-2000 = 0

# ===== العميل 90003 — صفوف تالفة + عملة غير معروفة =====
header(90003, 'عميل الاختبار الثالث')
currency('YR', 'ريال يمني')
opening(500, 0)
txn('2026-04-01', 'فاتورة المبيعات آجل', 401, 'صف سليم', None, 1000, 0)
txn('2026-04-02', 'قيد يومية', 402, 'صف تالف: مدين ودائن معًا', None, 100, 100)
txn('2026-04-03', 'قيد يومية', 403, 'صف تالف: مبلغ سالب', None, -50, 0)
totals('YR', 1000, 0, 'debit', 1500)

header(90004, 'عميل بعملة غير معروفة')
currency('XX', 'عملة مجهولة')
opening(100, 0)
txn('2026-05-01', 'فاتورة المبيعات آجل', 501, 'حركة بعملة مجهولة', None, 200, 0)
totals('XX', 200, 0, 'debit', 300)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixture.xlsx')
wb.save(out)
print('fixture written:', out)
