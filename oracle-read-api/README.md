# AlBinaa Oracle Read API

Standalone, SELECT-only gateway between AlBinaa Platform and Oracle 11g. It
must run near Oracle on a private interface. It never creates or changes Oracle
objects and has no INSERT, UPDATE, DELETE, MERGE, PL/SQL, procedure, or sequence
endpoint.

## Safety boundaries

- Startup accepts `ORACLE_USER=ALBINAA_RO` only and verifies the real Oracle
  session user before listening.
- Every database call passes through a SELECT/WITH-only executor and rolls back
  before releasing the connection.
- All request values use Oracle bind variables.
- A requested schema must be in the administrator-owned
  `ORACLE_ALLOWED_SCHEMAS` list. The current default is `IAS20261`.
- Every data endpoint requires a Bearer API key. The service binds to
  `127.0.0.1` by default.
- Error responses never return SQL, credentials, or Oracle error messages.

## Oracle 11g prerequisite

Node-oracledb Thin mode does not connect to Oracle 11g. Install a supported
64-bit Oracle Instant Client (for example 19c) on the gateway host and set
`ORACLE_CLIENT_LIB_DIR` to that directory. Its architecture must match Node.js.
Do not point the service at an old application-bundled Oracle client without
first confirming node-oracledb compatibility.

## Local configuration

1. Copy `.env.example` to `.env` locally. `.env` is ignored by Git.
2. Keep `ORACLE_USER=ALBINAA_RO`.
3. Enter the local password, Oracle connect string, Instant Client directory,
   and a long random `ORACLE_READ_API_KEY`. On this host the verified client
   directory is `E:\oracle\instantclient_19_32`.
4. Load the environment using the operating system or Node's env-file option.

PowerShell example (the real values remain in the ignored `.env` file):

```powershell
node --env-file=.env src/server.js
```

Then configure the platform backend with:

```text
ORACLE_READ_API_URL=http://127.0.0.1:3011
ORACLE_READ_API_KEY=<same key>
ORACLE_READ_SCHEMA=IAS20261
```

## Endpoints

- `GET /health` — process liveness; no Oracle query.
- `GET /health/compatibility?schema=IAS20261` — checks required live objects and
  columns after installation or a YemenSoft update.
- `GET /inventory/warehouses/:code`
- `GET /inventory/warehouses` — IAS20191 isolated web test only.
- `GET /inventory/items?search=&limit=` — IAS20191 isolated web test only.
- `GET /inventory/items/:code` — IAS20191 isolated web test only.
- `GET /inventory/items/labels?itemCodes=` — IAS20191 isolated web test only.
- `GET /inventory/stock?warehouseCode=&itemCode=&unitCode=&schema=`
- `GET /inventory/transfers/evidence?sourceTransferSerial=&sourceWarehouseCode=&destinationWarehouseCode=&itemCodes=&schema=`
- `GET /requests/catalog?schema=IAS20191&purpose=receipt&oracleUserId=1&branchNo=1`
  — returns schema-specific cashboxes, banks, collectors, parties, and verified
  analytical-account links. It is SELECT-only and applies `CASH_TYPE=1` for
  cash, `CASH_TYPE=2` for bank, `RCVD` for receipts, and `PYMNT` for payments.
- `GET /requests/created?schema=IAS20191&limit=100` — returns the requests that
  were created from the isolated platform test, their latest Oracle approval
  level, user, date, and state. It covers purchase requests, receipt and payment
  vouchers, journal requests, and inventory-transfer requests. This endpoint is
  restricted to `IAS20191` and performs SELECT statements only.
- `GET /inventory/counts/:documentNo?schema=IAS20191&inventoryType=1&branchNo=1&branchYear=2019&oracleUserId=1`
  — reads the proven `INVT008.230` document from `MASTER_INV` and `DETAIL_INV`,
  together with `IAS_INV_TYPES` / `IAS_PRIV_INV_TYPE`. This endpoint is
  restricted to `IAS20191`; it never creates, processes, adjusts, or posts an
  inventory count. A difference is returned only when the observed unit
  conversion is proven (`P_SIZE=1`); other rows remain explicitly uncomputed.

All endpoints except `/health` require:

```text
Authorization: Bearer <ORACLE_READ_API_KEY>
```

The evidence endpoint returns raw, precisely linked rows. The platform computes:

- source issued: `ITEM_MOVEMENT.DOC_SER = source.TR_SER`, `DOC_TYPE=7`, same
  `I_CODE`, source warehouse;
- destination document: another `IAS_WHTRNS_MST` row with
  `destination.TR_SER <> source.TR_SER` and
  `destination.F_TR_SER = source.TR_SER`;
- destination received: `ITEM_MOVEMENT.DOC_SER = destination.TR_SER`,
  `DOC_TYPE=8`, same `I_CODE`, destination warehouse;
- completed: `sourceIssued && destinationReceived`.

`TR_POST`, `STK_PROCESSED`, and `POST_DATE` are returned only as diagnostics.

The request catalog needs direct SELECT grants for `ALBINAA_RO` on the chosen
schema's `PRIV_CASH`, `CASH_IN_HAND`, `CASH_AT_BANK`,
`IAS_V_USR_COLLECTOR_PRV`, `COLLERCTOR`, `CUSTOMER`, `V_DETAILS`, `S_EMP`,
`ACCOUNT`, and `GLS_ACCNT_DTL`. Granting access does not change YemenSoft
business rows. Do not grant INSERT, UPDATE, DELETE, EXECUTE, or sequence access
to `ALBINAA_RO`.

The isolated inventory-count lookup additionally needs direct SELECT grants on
`IAS20191.MASTER_INV`, `IAS20191.DETAIL_INV`, `IAS20191.IAS_INV_TYPES`, and
`IAS20191.IAS_PRIV_INV_TYPE`. It needs no INSERT, UPDATE, DELETE, EXECUTE,
sequence, processing, adjustment, or posting privilege.

Customers, suppliers, and employees are mapped only through their verified
tables and analytical-account links. Generic debtor/creditor lists remain
empty until each schema's authoritative main accounts are confirmed; unmatched
analytical accounts are returned under `other` rather than guessed from an
analytical type number.

The confirmed request-account hierarchy is schema-specific. `IAS20191` uses
`111101001` and `111101002` for cashboxes, `111202001` for banks,
`116101001` for employees, and `211101001` plus `211102001` for suppliers.
`IAS20261` uses `111101001` and `111101002` for cashboxes, `111202001` through
`111202007` for banks, `116101001` for employees, `211101001` plus `211102001`
for suppliers, and `113101001` plus `113101002` for debtors under the advances
group. The catalog reads the analytical type and detail code from Oracle; it
does not invent either value except for the exact, historically verified
`IAS20191` links documented below. This mapping changes no Oracle row.

The general analytical-account list remains capped at 5,000 rows, while rows
under the confirmed customer, employee, supplier, debtor, and creditor main
accounts are always included. This prevents a valid party link from disappearing
only because it sorts after the general safety limit.

For the isolated `IAS20191` test schema, live YemenSoft requests confirm that
customers use main account `112101001`, the customer code itself as
`AC_CODE_DTL`, and analytical type `3`. The catalog applies this scoped mapping
when `GLS_ACCNT_DTL` does not expose a row; it is not applied to `IAS20261`.

Live YemenSoft payment requests in `IAS20191` also confirm the following narrow
party links: supplier `10001` uses `211101001`, supplier `20001` uses
`211102001`, both with `AC_DTL_TYP=4`; employee `1` uses `116101001` with
`AC_DTL_TYP=7`. The catalog applies only these exact links in `IAS20191`. It
does not extrapolate them to another party code or to `IAS20261`.

After updating the read gateway source used by the isolated web test, run
`scripts\restart-ias20191-read-gateway.cmd`. It prompts only for the
`ALBINAA_RO` password, preserves the existing web and writer configuration,
restarts only localhost port `3013`, and verifies `/requests/created` in
SELECT-only mode.

For a deeper employee/supplier account-link check, run
`scripts\run-party-account-diagnostic-secure.cmd`. It inspects employee `1`
and suppliers `10001` and `20001` in both schemas using `ALBINAA_RO` only. The
report checks the confirmed main accounts `116101001`, `211101001`, and
`211102001`, but never invents a missing analytical account code or type and
never writes to Oracle. It also reports up to 200 matching historical request
voucher lines from `IAS_RQ_VCHR_DTL` as evidence of the actual `AC_CODE_DTL`
and `AC_DTL_TYP` used by YemenSoft.

## Verification

```powershell
npm install
npm test
npm run check
```

After the service starts, call compatibility first. Then verify the known live
fixtures without changing Oracle:

- completed source: `20260000011119`, item `295602501014`, source `102`,
  destination `101`; expected linked destination `20260000011129`;
- incomplete source: `202600000111130`, item `111100401003`, source `102`,
  destination `101`; expected no distinct destination receipt as of the prior
  live observation.

## Persistent Windows operation

Run `npm run configure:persistent` once to create the ignored local `.env`,
generate a production API key, restrict the gateway secret file to the current
Windows user, and copy only the shared API key/schema into the repository-root
ignored `.env` used by Docker Compose. Then run `npm run install:persistent` to
register and verify the per-user `AlBinaa Oracle Read API` scheduled task.

The task runs at user logon, binds only to `127.0.0.1:3011`, and writes runtime
logs under the ignored `oracle-read-api/logs/` directory. Docker reaches it via
`http://host.docker.internal:3011`; no Oracle listener, gateway port, or firewall
rule is exposed or changed by these scripts.
