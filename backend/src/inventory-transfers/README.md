# INVT001.225 safe integration contract

This module is intentionally platform-first and Oracle-read-only.

State flow:

`draft -> pending_approval -> approved | rejected`

Approval always runs a fresh dry run. Any missing warehouse, item, unit, or
insufficient source stock blocks approval. A rejected request can be submitted
again. No endpoint in this module creates an Oracle request or document.

The optional `ORACLE_READ_API_URL` must point to a separately secured gateway
whose database account is the future `ALBINAA_RO` account with explicit
SELECT-only grants. Never configure this integration with `YS`. The configurable
`ORACLE_READ_SCHEMA` (currently `IAS20261`) is sent on every request. This
backend calls only:

- `GET /inventory/warehouses/:code`
- `GET /inventory/stock?warehouseCode=&itemCode=&unitCode=`
- `GET /inventory/transfers/evidence?sourceTransferSerial=&sourceWarehouseCode=&destinationWarehouseCode=&itemCodes=`

The gateway contract is grounded in these Oracle 11g sources:

- warehouses: `WAREHOUSE_DETAILS`
- item/unit/package size: `ITEM_DETAILS` (`P_SIZE` must be returned)
- available quantity: `IAS_V_ITM_AVLQTY`
- outgoing request: `IAS_OUT_REQUEST_MST/DTL`
- transfer documents: `IAS_WHTRNS_MST/DTL`
- actual inventory effect: `ITEM_MOVEMENT`

Stock results return `warehouseExists`, `itemExists`, `unitExists`,
`packageSize`, and `availableQuantity`. Quantity reconciliation must convert
and aggregate movements across all units/package sizes for the item and
warehouse; grouping by unit alone can create false differences.

The transfer-status response keeps these values independent:

- `outReqSer`
- `transferDocumentNumber`
- `sourceTransferSerial`
- `destinationTransferSerial`
- `sourceIssued`
- `destinationReceived`
- `transferCompleted`

`sourceIssued` requires, for every requested `I_CODE`, a matching
`ITEM_MOVEMENT` row where `DOC_SER = source.TR_SER`, `DOC_TYPE=7`, and
`W_CODE` is the source warehouse. `destinationReceived` requires a *different*
`IAS_WHTRNS_MST` row where `destination.TR_SER <> source.TR_SER` and
`destination.F_TR_SER = source.TR_SER`, plus matching `ITEM_MOVEMENT` rows
where `DOC_SER = destination.TR_SER`, `DOC_TYPE=8`, the same `I_CODE` values,
and `W_CODE` is the destination warehouse. `transferCompleted` is computed as
`sourceIssued && destinationReceived`. `TR_POST`, `STK_PROCESSED`, and
`POST_DATE` are returned only under diagnostics and never decide any state.

The runnable gateway is in the repository-root `oracle-read-api/` package. Its
Oracle 11g SELECT-only query implementation is mirrored by
`oracle-transfer-evidence.queries.ts` here for the backend contract tests. It uses bind variables for all values;
only the administrator-configured schema is interpolated after strict Oracle
identifier validation. Dry Run invokes this evidence read automatically when
the platform request has `oracleSourceTransferSerial`, returns the calculated
status, and persists the three calculated flags. Before that serial exists,
Dry Run remains a stock/structure check and returns `oracleTransferStatus: null`.

Verified examples for gateway tests/fixtures:

- completed: source `TR_SER=20260000011119`, warehouse `102`, item
  `295602501014`, quantity `90`, `DOC_TYPE=7`; destination
  `TR_SER=20260000011129`, warehouse `101`, `DOC_TYPE=8`,
  `F_TR_SER=20260000011119`.
- incomplete as of the live check: `OUT_REQ_SER=20260000012` led to
  `TR_NO=30` / `TR_SER=202600000111130`; item `111100401003`, quantity `1`,
  warehouse `102`, `DOC_TYPE=7`, with no matching `DOC_TYPE=8` effect found.

The gateway must expose SELECT statements only. It must not expose or execute
`INSERT`, `UPDATE`, `DELETE`, PL/SQL, stored procedures, or sequence `NEXTVAL`.
It must validate `schema` against an administrator-owned allowlist before using
it as an Oracle identifier; it must never interpolate arbitrary request input.
