# -*- coding: utf-8 -*-
"""
CLI Bridge — يربط الـ Parser المُختبر (albinaa_parser.py) بالـ Backend.
لا يعيد كتابة منطق التحليل: يستدعيه ويخرج JSON منظمًا على stdout.

الاستخدام:  python3 parser_cli.py <path.xlsx>
المخرجات:   JSON واحد { ok, stats, accounts[], errors[], skipped_rows }
كل التواريخ ISO-8601، والأرقام أرقام JSON عادية.
"""
import json
import sys
from datetime import datetime, date

from albinaa_parser import parse_workbook


def iso(v):
    if isinstance(v, (datetime, date)):
        return v.date().isoformat() if isinstance(v, datetime) else v.isoformat()
    return v


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'ok': False, 'error': 'usage: parser_cli.py <file.xlsx>'}))
        sys.exit(2)
    path = sys.argv[1]
    try:
        res = parse_workbook(path)
    except Exception as e:  # ملف تالف/غير مقروء — خطأ مضبوط وليس Stack trace
        print(json.dumps({'ok': False, 'error': f'{type(e).__name__}: {e}'}, ensure_ascii=False))
        sys.exit(1)

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

    out = {
        'ok': True,
        'stats': res.stats,
        'accounts': accounts,
        'errors': [
            {'rowNumber': rn, 'message': msg, 'raw': [iso(v) for v in (raw or [])]}
            for rn, msg, raw in res.errors
        ],
        'skippedEmptyRows': len(res.skipped_rows),
    }
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
