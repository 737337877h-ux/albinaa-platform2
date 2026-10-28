# Oracle Write API — isolated IAS20191 test only

This gateway is deliberately separate from `oracle-read-api`. It accepts only
`ALBINAAWRITER`, only the `IAS20191` schema, and isolated draft operations:

`POST /inventory/out-requests`

`POST /purchasing/requests/dry-run`

`POST /purchasing/requests`

`POST /inventory/counts/dry-run`

`POST /inventory/counts`

`GET /accounting/currencies`

`POST /accounting/vouchers/dry-run` and `POST /accounting/vouchers`

`POST /accounting/journals/dry-run` and `POST /accounting/journals`

The operation creates an unapproved, unprocessed `IAS_OUT_REQUEST_MST/DTL`
draft and its pending level-one `S_APPRVD_MOV` workflow row in a single
transaction. The approval row matches the live IAS20191/YemenSoft evidence for
`DOC_TYP=31`, `LVL_NO=1`, and `ORDR_NO=1`; it does not approve the request. The
gateway validates warehouses and item units, uses `IAS_DOC_SEQ_OTHR.NEXTVAL`
for detail sequence values, serializes number allocation with a table lock,
and uses `DOC_SER_EXTRNL=ALBINAA:<reference>` for idempotent retries.

The purchase Dry Run validates the warehouse and every item/unit/package size
without taking a table lock, allocating a sequence, or writing to Oracle. The
purchase create route inserts `P_REQUEST`, `P_REQUEST_DETAIL`, and the pending
level-one `S_APPRVD_MOV` row in one transaction. It follows the verified
APST001 evidence: `PR_TYPE=1`, `DOC_TYP=40`, `LVL_NO=1`, and `ORDR_NO=1`.
Purchase idempotency uses a stable 15-character SHA-256-derived `REF_NO`, so a
retry returns the original draft.

The accounting routes are pinned to the live IAS20191 request structures:
`IAS_RQ_VCHR_MST/DTL` for receipt (`DOC_TYPE=92`) and payment (`DOC_TYPE=93`)
requests, and `IAS_RQ_JRNL_MST/DTL` for journal requests (`DOC_TYPE=85`). Each
new draft gets one pending level-one `S_APPRVD_MOV` row. Only cash and bank
transfer are accepted; bank cheque is rejected. Currency code, local/foreign
classification, fraction digits and the current fallback exchange rate are
read from IAS20191 metadata. Local voucher foreign amounts are `NULL`; local
journal foreign amounts are zero. Accounting idempotency uses a stable token
in `FIELD10`, and long YemenSoft serials remain strings in Node.js.

Voucher reference numbers (`IAS_RQ_VCHR_MST.REF_NO`) and notice numbers
(`IAS_RQ_VCHR_DTL.NOTE_NO`) must be unique across IAS20191 voucher requests.
Dry Run reports duplicates without writing, and create repeats the same checks
under exclusive master/detail table locks before allocating a number or
inserting a row.

Purchase requests accept up to 50 item rows. Voucher requests accept up to 100
counterparty rows and write one `IAS_RQ_VCHR_DTL` row per line while keeping a
single master total and approval row. Journal requests accept up to 100 debit
or credit rows and must balance in the local currency. Journal reference
numbers may repeat; voucher reference and notice numbers may not.

Inventory-count drafts follow the proven `INVT008.230` IAS20191 map and accept
up to 200 item rows. Type `1` is a web/manual count and type `2` is a mobile/app
count. Dry Run reads `IAS_INV_TYPES`, `IAS_PRIV_INV_TYPE`, warehouses, item
units/package sizes, and available quantities without locking or writing. Create
locks `MASTER_INV` only while allocating the next number, then inserts one
unprocessed `MASTER_INV` row and its `DETAIL_INV` rows in one transaction. The
draft is saved with `PROCESSED=0`, `EXTERNAL_POST=0`, and
`PROCESSED_ADJ=0`; this route never posts the count, processes differences, or
creates an inventory movement. A stable 15-character `REF_NO` makes retries
idempotent.

The isolated writer needs only these additional IAS20191 grants for count
creation (in addition to its existing session and catalog grants):

```sql
GRANT SELECT ON IAS20191.IAS_INV_TYPES TO ALBINAAWRITER;
GRANT SELECT ON IAS20191.IAS_PRIV_INV_TYPE TO ALBINAAWRITER;
GRANT SELECT, INSERT ON IAS20191.MASTER_INV TO ALBINAAWRITER;
GRANT SELECT, INSERT ON IAS20191.DETAIL_INV TO ALBINAAWRITER;
```

No equivalent grants or routes are permitted for `IAS20261`.

The web form does not ask users to type Oracle account or analytical-type
codes. Those values come from the SELECT-only IAS20191 request catalog. Cash
and bank lists are permission-filtered, and a customer's assigned collector is
used automatically when present; otherwise the form offers only collectors
visible to the configured Oracle user. A missing or ambiguous account link
blocks Dry Run instead of guessing.

The confirmed IAS20191 customer mapping is main account `112101001`, customer
code as the analytical account code, and analytical type `3`. This rule is
restricted to IAS20191 and does not authorize any read or write behavior in
IAS20261.

`scripts/run-accounting-dry-run-secure.ps1` performs the live currency and
amount checks through `ALBINAA_RO` with `SET TRANSACTION READ ONLY`.
`scripts/run-accounting-write-metadata-secure.ps1` inspects required columns
and key constraints without writing. Neither script requires unlocking the
writer account.

There are no approval-decision, processing, transfer-document, update, delete,
PL/SQL, or `IAS20261` routes. Keep `ALBINAAWRITER` locked whenever an authorized
test is not actively running.

`scripts/run-live-smoke-secure.ps1` performs one authorized end-to-end HTTP
test with a process-only password and API key. Its fixed external reference
makes retries return the same draft instead of creating duplicates.

`scripts/purchase-request-live-smoke.js` calls the purchase Dry Run, creates
one authorized draft, then retries the same reference to verify idempotency.
