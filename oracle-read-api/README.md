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
- `GET /inventory/stock?warehouseCode=&itemCode=&unitCode=&schema=`
- `GET /inventory/transfers/evidence?sourceTransferSerial=&sourceWarehouseCode=&destinationWarehouseCode=&itemCodes=&schema=`

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
