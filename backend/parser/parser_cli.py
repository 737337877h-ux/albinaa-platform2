# -*- coding: utf-8 -*-
"""
CLI Bridge — يربط محللات الاستيراد (albinaa_parser + import_profiles) بالـ Backend.
لا يعيد كتابة منطق التحليل: يستدعيه ويخرج JSON منظمًا على stdout.

الاستخدام:  python3 parser_cli.py <path.xlsx|xlsm|xls>
المخرجات:   JSON واحد
            { ok, profile, format, stats, errors[], skippedEmptyRows,
              accounts[], customers[], balances[], agingSummary[], agingDetails[] }

كل التواريخ ISO-8601، والأرقام أرقام JSON عادية.
"""
import json
import sys
from datetime import datetime, date

from albinaa_parser import parse_workbook
from import_profiles import (
    PROFILE_STATEMENT, PROFILE_MASTER, PROFILE_BALANCE,
    PROFILE_AGING_SUMMARY, PROFILE_AGING_DETAILS,
    detect_profile, parse_profile, read_table,
)


def iso(v):
    if isinstance(v, (datetime, date)):
        return v.date().isoformat() if isinstance(v, datetime) else v.isoformat()
    return v


def _fail(message, code=1):
    print(json.dumps({'ok': False, 'error': message}, ensure_ascii=False))
    sys.exit(code)


def _statement_payload(path):
    """تحليل كشف الحساب التحليلي عبر albinaa_parser المُختبر."""
    res = parse_workbook(path)
    accounts = []
    for (code, ccy_raw), acc in res.accounts.items():
        accounts.append({
            'customerCode': str(acc.customer_code),
            'customerName': acc.customer_name,
            'currency': acc.currency,            # ISO: YER/SAR/USD
            'currencyRaw': acc.currency_raw,     # كما في الملف: YR/SR/$
            'currencyName': acc.currency_name,
            'openingDebit': acc.opening_debit,
            'openingCredit': acc.opening_credit,
            'computedBalance': acc.computed_balance,
            'declaredBalance': acc.declared_balance,
            'declaredLabel': acc.declared_label,
            'fragments': acc.fragments,
            'warnings': acc.parse_warnings,
            'transactions': [
                {
                    'rowNumber': t.row_number,
                    'date': iso(t.tx_date),
                    'docType': t.doc_type,
                    'docNumber': None if t.doc_number is None else str(t.doc_number),
                    'description': t.description,
                    'reference': None if t.reference is None else str(t.reference),
                    'debit': t.debit,
                    'credit': t.credit,
                    'lineHash': t.line_hash,
                }
                for t in acc.transactions
            ],
        })
    return {
        'stats': res.stats,
        'accounts': accounts,
        'errors': [
            {'rowNumber': rn, 'message': msg, 'raw': [iso(v) for v in (raw or [])]}
            for rn, msg, raw in res.errors
        ],
        'skippedEmptyRows': len(res.skipped_rows),
    }


def main():
    if len(sys.argv) < 2:
        _fail('usage: parser_cli.py <file.xlsx|xlsm|xls>', 2)
    path = sys.argv[1]

    # القراءة + كشف النوع أولًا (يشمل فحص CP1256 الصارم للملفات النصية)
    try:
        rows, fmt = read_table(path)
        profile = detect_profile(rows)
    except Exception as e:
        _fail(f'{type(e).__name__}: {e}')

    out = {
        'ok': True,
        'profile': profile,
        'format': fmt,
        'stats': None,
        'errors': [],
        'skippedEmptyRows': 0,
        'accounts': [],
        'customers': [],
        'balances': [],
        'agingSummary': [],
        'agingDetails': [],
    }

    try:
        if profile == PROFILE_STATEMENT:
            payload = _statement_payload(path)
        elif profile in (PROFILE_MASTER, PROFILE_BALANCE,
                         PROFILE_AGING_SUMMARY, PROFILE_AGING_DETAILS):
            payload = parse_profile(rows, profile)
        else:  # لا يمكن الوصول إليه عمليًا — حماية إضافية
            _fail(f'نوع ملف غير معروف: {profile}')
        out.update(payload)
    except Exception as e:
        _fail(f'{type(e).__name__}: {e}')

    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
