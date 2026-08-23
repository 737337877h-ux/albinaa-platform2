'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const oracledb = require('oracledb');
const { loadConfig, resolveSchema } = require('./config');
const { OracleReadPool } = require('./oracle');
const queries = require('./queries');

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function authorized(request, expectedKey) {
  const prefix = 'Bearer ';
  const header = request.headers.authorization || '';
  if (!header.startsWith(prefix)) return false;
  const received = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(expectedKey);
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function requiredParam(url, name, pattern, maxLength = 80) {
  const value = url.searchParams.get(name)?.trim();
  if (!value || value.length > maxLength || (pattern && !pattern.test(value))) {
    throw new RequestError(`Invalid ${name}`);
  }
  return value;
}

class RequestError extends Error {}

function mapSource(row) {
  if (!row) return null;
  return {
    transferSerial: row.TRANSFER_SERIAL,
    transferDocumentNumber: row.TRANSFER_DOCUMENT_NUMBER ?? null,
    warehouseCode: row.WAREHOUSE_CODE,
    destinationWarehouseCode: row.DESTINATION_WAREHOUSE_CODE,
    trPost: row.TR_POST ?? null,
    stkProcessed: row.STK_PROCESSED ?? null,
    postDate: row.POST_DATE ?? null,
  };
}

function createHandler(config, db) {
  return async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (request.method === 'GET' && url.pathname === '/health') {
        return json(response, 200, { status: 'ok', mode: 'SELECT_ONLY' });
      }
      if (!authorized(request, config.apiKey)) return json(response, 401, { message: 'Unauthorized' });
      if (request.method !== 'GET') return json(response, 405, { message: 'Only GET is allowed' });
      const schema = resolveSchema(config, url.searchParams.get('schema'));

      if (url.pathname === '/health/compatibility') {
        const check = queries.compatibility(schema);
        const result = await db.select(check.sql, check.binds);
        const actual = new Map();
        for (const row of result.rows) {
          if (!actual.has(row.TABLE_NAME)) actual.set(row.TABLE_NAME, new Set());
          actual.get(row.TABLE_NAME).add(row.COLUMN_NAME);
        }
        const missing = Object.entries(check.required).flatMap(([table, columns]) =>
          columns.filter((column) => !actual.get(table)?.has(column)).map((column) => `${table}.${column}`));
        return json(response, missing.length ? 503 : 200, { compatible: missing.length === 0, schema, missing });
      }

      const warehouseMatch = url.pathname.match(/^\/inventory\/warehouses\/([^/]+)$/);
      if (warehouseMatch) {
        const warehouseCode = decodeURIComponent(warehouseMatch[1]);
        if (!warehouseCode || warehouseCode.length > 80) throw new RequestError('Invalid warehouseCode');
        const result = await db.select(queries.warehouseExists(schema), { warehouseCode });
        return json(response, 200, { exists: result.rows.length > 0 });
      }

      if (url.pathname === '/inventory/stock') {
        const warehouseCode = requiredParam(url, 'warehouseCode');
        const itemCode = requiredParam(url, 'itemCode');
        const unitCode = requiredParam(url, 'unitCode', null, 40);
        const sql = queries.stock(schema);
        const [warehouse, item, unit, available] = await Promise.all([
          db.select(queries.warehouseExists(schema), { warehouseCode }),
          db.select(sql.itemExists, { itemCode }),
          db.select(sql.unit, { itemCode, unitCode }),
          db.select(sql.available, { warehouseCode, itemCode, unitCode }),
        ]);
        const unitRow = unit.rows[0];
        return json(response, 200, {
          warehouseExists: warehouse.rows.length > 0,
          itemExists: item.rows.length > 0,
          unitExists: Boolean(unitRow),
          packageSize: unitRow?.PACKAGE_SIZE == null ? null : Number(unitRow.PACKAGE_SIZE),
          availableQuantity: Number(available.rows[0]?.AVAILABLE_QUANTITY || 0),
        });
      }

      if (url.pathname === '/inventory/transfers/evidence') {
        const sourceTransferSerial = requiredParam(url, 'sourceTransferSerial', /^\d{1,20}$/, 20);
        const sourceWarehouseCode = requiredParam(url, 'sourceWarehouseCode');
        const destinationWarehouseCode = requiredParam(url, 'destinationWarehouseCode');
        const itemCodes = requiredParam(url, 'itemCodes', null, 8000).split(',').map((code) => code.trim());
        const sql = queries.transferEvidence(schema, itemCodes);
        const [source, destinations, movements] = await Promise.all([
          db.select(sql.source, { sourceTransferSerial, sourceWarehouseCode, destinationWarehouseCode }),
          db.select(sql.destinations, { sourceTransferSerial, destinationWarehouseCode }),
          db.select(sql.movements, { sourceTransferSerial, ...sql.itemBinds }),
        ]);
        return json(response, 200, {
          source: mapSource(source.rows[0]),
          destinationDocuments: destinations.rows.map((row) => ({
            transferSerial: row.TRANSFER_SERIAL,
            sourceTransferSerial: row.SOURCE_TRANSFER_SERIAL,
            warehouseCode: row.WAREHOUSE_CODE,
          })),
          movements: movements.rows.map((row) => ({
            documentSerial: row.DOCUMENT_SERIAL,
            documentType: Number(row.DOCUMENT_TYPE),
            itemCode: row.ITEM_CODE,
            warehouseCode: row.WAREHOUSE_CODE,
          })),
        });
      }

      return json(response, 404, { message: 'Not found' });
    } catch (error) {
      if (error instanceof RequestError || /schema/i.test(error.message)) {
        return json(response, 400, { message: error.message });
      }
      console.error('Oracle Read API request failed', { name: error.name, errorNum: error.errorNum });
      return json(response, 503, { message: 'Oracle read is temporarily unavailable' });
    }
  };
}

async function main() {
  const config = loadConfig();
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  const server = http.createServer(createHandler(config, db));
  server.listen(config.port, config.host, () => {
    console.log(`Oracle Read API listening on http://${config.host}:${config.port}`);
  });
  const shutdown = async () => {
    server.close();
    await db.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Oracle Read API failed to start', { name: error.name, message: error.message, errorNum: error.errorNum });
    process.exitCode = 1;
  });
}

module.exports = { createHandler };
