'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const oracledb = require('oracledb');
const { loadIas20261InventoryConfig } = require('./ias20261-inventory-config');
const { Ias20261InventoryConflictError, Ias20261InventoryWriter } = require('./ias20261-inventory-writer');

class RequestError extends Error {}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function authorized(request, apiKey) {
  const header = request.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return false;
  const received = Buffer.from(header.slice(7));
  const expected = Buffer.from(apiKey);
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

async function body(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1_000_000) throw new RequestError('Payload too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError('Invalid JSON'); }
}

function shortString(value, name, maxLength) {
  if (typeof value !== 'string') throw new RequestError(`Invalid ${name}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new RequestError(`Invalid ${name}`);
  return normalized;
}

function validateInventoryPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RequestError('Invalid payload');
  const externalReference = shortString(payload.externalReference, 'externalReference', 120);
  if (!/^[A-Za-z0-9:_-]+$/.test(externalReference)) throw new RequestError('Invalid externalReference');
  const inventoryType = Number(payload.inventoryType);
  if (![1, 2].includes(inventoryType)) throw new RequestError('Invalid inventoryType');
  const warehouseCode = Number(payload.warehouseCode);
  if (!Number.isSafeInteger(warehouseCode) || warehouseCode < 1) throw new RequestError('Invalid warehouseCode');
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 200) {
    throw new RequestError('Invalid lines');
  }
  return {
    externalReference,
    inventoryType,
    warehouseCode,
    description: typeof payload.description === 'string' && payload.description.trim()
      ? shortString(payload.description, 'description', 250)
      : inventoryType === 2 ? 'جرد من تطبيق البناء الراقي' : 'جرد من منصة البناء الراقي',
    lines: payload.lines.map((line, index) => {
      const countedQuantity = Number(line?.countedQuantity);
      if (!Number.isFinite(countedQuantity) || countedQuantity < 0 || countedQuantity > 1_000_000_000) {
        throw new RequestError(`Invalid lines[${index}].countedQuantity`);
      }
      const expireDate = line?.expireDate == null || line.expireDate === ''
        ? '1900-01-01' : shortString(line.expireDate, `lines[${index}].expireDate`, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expireDate)) throw new RequestError(`Invalid lines[${index}].expireDate`);
      return {
        itemCode: shortString(line?.itemCode, `lines[${index}].itemCode`, 30),
        unitCode: shortString(line?.unitCode, `lines[${index}].unitCode`, 10),
        countedQuantity,
        batchNo: line?.batchNo == null || line.batchNo === ''
          ? '0' : shortString(String(line.batchNo), `lines[${index}].batchNo`, 30),
        expireDate,
      };
    }),
  };
}

function createHandler(config, writer) {
  return async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (request.method === 'GET' && url.pathname === '/health') {
        return json(response, 200, {
          status: 'ok', mode: 'IAS20261_INVENTORY_COUNT_DRAFT_INSERT_ONLY', schema: config.schema,
        });
      }
      if (!authorized(request, config.apiKey)) return json(response, 401, { message: 'Unauthorized' });
      if (request.method === 'POST' && url.pathname === '/inventory/counts/dry-run') {
        return json(response, 200, await writer.dryRun(validateInventoryPayload(await body(request))));
      }
      if (request.method === 'POST' && url.pathname === '/inventory/counts') {
        const result = await writer.createDraft(validateInventoryPayload(await body(request)));
        return json(response, result.created ? 201 : 200, result);
      }
      return json(response, 404, { message: 'Not found' });
    } catch (error) {
      if (error instanceof RequestError) return json(response, 400, { message: error.message });
      if (error instanceof Ias20261InventoryConflictError) {
        return json(response, 409, { message: error.message, code: error.code });
      }
      console.error('IAS20261 Inventory Count Draft API request failed', { name: error.name, errorNum: error.errorNum });
      return json(response, 503, { message: 'بوابة مسودات الجرد IAS20261 غير متاحة مؤقتًا' });
    }
  };
}

async function main() {
  const config = loadIas20261InventoryConfig();
  const writer = new Ias20261InventoryWriter(oracledb, config);
  await writer.start();
  const server = http.createServer(createHandler(config, writer));
  server.listen(config.port, config.host, () => {
    console.log(`IAS20261 Inventory Count Draft API listening on http://${config.host}:${config.port}`);
  });
  const shutdown = async () => {
    server.close();
    await writer.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('IAS20261 Inventory Count Draft API failed to start', {
      name: error.name, message: error.message, errorNum: error.errorNum,
    });
    process.exitCode = 1;
  });
}

module.exports = { RequestError, createHandler, validateInventoryPayload };
