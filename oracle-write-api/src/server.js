'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const oracledb = require('oracledb');
const { loadConfig } = require('./config');
const { OracleConflictError, OracleOutRequestWriter } = require('./oracle-writer');

class RequestError extends Error {}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function authorized(request, expectedKey) {
  const header = request.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return false;
  const received = Buffer.from(header.slice(7));
  const expected = Buffer.from(expectedKey);
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new RequestError('Request body is too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError('Invalid JSON body'); }
}

function shortString(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) throw new RequestError(`Invalid ${name}`);
  return value.trim();
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RequestError('Invalid payload');
  const externalReference = shortString(payload.externalReference, 'externalReference', 120);
  if (!/^[A-Za-z0-9:_-]+$/.test(externalReference)) throw new RequestError('Invalid externalReference');
  const sourceWarehouseCode = shortString(payload.sourceWarehouseCode, 'sourceWarehouseCode', 10);
  const destinationWarehouseCode = shortString(payload.destinationWarehouseCode, 'destinationWarehouseCode', 10);
  if (!/^\d+$/.test(sourceWarehouseCode) || !/^\d+$/.test(destinationWarehouseCode) || sourceWarehouseCode === destinationWarehouseCode) {
    throw new RequestError('Invalid warehouses');
  }
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 50) throw new RequestError('Invalid lines');
  const lines = payload.lines.map((line, index) => {
    const itemCode = shortString(line?.itemCode, `lines[${index}].itemCode`, 30);
    const unitCode = shortString(line?.unitCode, `lines[${index}].unitCode`, 10);
    const quantity = Number(line?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000_000) throw new RequestError(`Invalid lines[${index}].quantity`);
    return { itemCode, unitCode, quantity };
  });
  return {
    externalReference,
    sourceWarehouseCode: Number(sourceWarehouseCode),
    destinationWarehouseCode: Number(destinationWarehouseCode),
    requestSide: typeof payload.requestSide === 'string' && payload.requestSide.trim()
      ? shortString(payload.requestSide, 'requestSide', 60) : 'منصة البناء الراقي',
    notes: typeof payload.notes === 'string' && payload.notes.trim()
      ? shortString(payload.notes, 'notes', 250) : 'طلب تجريبي من منصة البناء الراقي',
    lines,
  };
}

function validatePurchaseRequestPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RequestError('Invalid payload');
  const externalReference = shortString(payload.externalReference, 'externalReference', 120);
  if (!/^[A-Za-z0-9:_-]+$/.test(externalReference)) throw new RequestError('Invalid externalReference');
  const warehouseCode = shortString(payload.warehouseCode, 'warehouseCode', 10);
  if (!/^\d+$/.test(warehouseCode)) throw new RequestError('Invalid warehouseCode');
  const hierarchyNo = payload.hierarchyNo === undefined ? 1 : Number(payload.hierarchyNo);
  if (!Number.isSafeInteger(hierarchyNo) || hierarchyNo < 1) throw new RequestError('Invalid hierarchyNo');
  const requiredDate = payload.requiredDate === undefined
    ? '2020-12-31'
    : shortString(payload.requiredDate, 'requiredDate', 10);
  if (!/^2020-12-31$/.test(requiredDate)) throw new RequestError('Invalid requiredDate');
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 50) throw new RequestError('Invalid lines');
  const lines = payload.lines.map((line, index) => {
    const itemCode = shortString(line?.itemCode, `lines[${index}].itemCode`, 30);
    const unitCode = shortString(line?.unitCode, `lines[${index}].unitCode`, 10);
    const quantity = Number(line?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000_000) throw new RequestError(`Invalid lines[${index}].quantity`);
    return { itemCode, unitCode, quantity };
  });
  return {
    externalReference,
    warehouseCode: Number(warehouseCode),
    hierarchyNo,
    requiredDate,
    requestSide: typeof payload.requestSide === 'string' && payload.requestSide.trim()
      ? shortString(payload.requestSide, 'requestSide', 60) : 'منصة البناء الراقي',
    notes: typeof payload.notes === 'string' && payload.notes.trim()
      ? shortString(payload.notes, 'notes', 250) : 'طلب شراء تجريبي من منصة البناء الراقي',
    lines,
  };
}

function positiveAmount(value, name = 'amount') {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000) throw new RequestError(`Invalid ${name}`);
  return amount;
}

function optionalString(value, name, maxLength) {
  return typeof value === 'string' && value.trim() ? shortString(value, name, maxLength) : null;
}

function validateVoucherRequestPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RequestError('Invalid payload');
  const kind = payload.kind;
  const paymentMethod = payload.paymentMethod;
  if (!['receipt', 'payment'].includes(kind)) throw new RequestError('Invalid kind');
  if (!['cash', 'bank_transfer'].includes(paymentMethod)) throw new RequestError('Invalid paymentMethod');
  const externalReference = shortString(payload.externalReference, 'externalReference', 120);
  if (!/^[A-Za-z0-9:_-]+$/.test(externalReference)) throw new RequestError('Invalid externalReference');
  const currencyCode = shortString(payload.currencyCode, 'currencyCode', 7);
  const cashOrBankNo = Number(payload.cashOrBankNo);
  if (!Number.isSafeInteger(cashOrBankNo) || cashOrBankNo < 1) throw new RequestError('Invalid cashOrBankNo');
  const referenceNo = optionalString(payload.referenceNo, 'referenceNo', 30);
  const noticeNo = optionalString(payload.noticeNo, 'noticeNo', 30);
  const recipientName = optionalString(payload.recipientName, 'recipientName', 100);
  const collectorNo = payload.collectorNo == null || payload.collectorNo === '' ? null : Number(payload.collectorNo);
  const commissionPercent = payload.commissionPercent == null || payload.commissionPercent === '' ? null : Number(payload.commissionPercent);
  if (collectorNo !== null && (!Number.isSafeInteger(collectorNo) || collectorNo < 1)) throw new RequestError('Invalid collectorNo');
  if (commissionPercent !== null && (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100)) throw new RequestError('Invalid commissionPercent');
  if (paymentMethod === 'bank_transfer' && (!noticeNo || !referenceNo)) throw new RequestError('referenceNo and noticeNo are required for bank transfer');
  if (kind === 'payment' && !recipientName) throw new RequestError('recipientName is required for payment');
  const rawLines = Array.isArray(payload.lines) ? payload.lines : [{
    amount: payload.amount, currencyCode: payload.currencyCode, accountCode: payload.accountCode,
    analyticalAccountCode: payload.analyticalAccountCode,
    analyticalType: payload.analyticalType, description: payload.description,
  }];
  if (rawLines.length < 1 || rawLines.length > 100) throw new RequestError('Invalid lines');
  const lines = rawLines.map((line, index) => {
    const analyticalType = Number(line?.analyticalType);
    if (!Number.isSafeInteger(analyticalType) || analyticalType < 1) throw new RequestError(`Invalid lines[${index}].analyticalType`);
    return {
      amount: positiveAmount(line?.amount, `lines[${index}].amount`),
      currencyCode: shortString(line?.currencyCode || currencyCode, `lines[${index}].currencyCode`, 7),
      accountCode: shortString(line?.accountCode, `lines[${index}].accountCode`, 30),
      analyticalAccountCode: shortString(line?.analyticalAccountCode, `lines[${index}].analyticalAccountCode`, 30),
      analyticalType,
      description: optionalString(line?.description, `lines[${index}].description`, 250)
        || shortString(payload.description, 'description', 250),
    };
  });
  const amount = payload.amount === undefined || payload.amount === null || payload.amount === ''
    ? (lines.every((line) => line.currencyCode === currencyCode)
      ? lines.reduce((sum, line) => sum + line.amount, 0)
      : (() => { throw new RequestError('amount is required when voucher lines use multiple currencies'); })())
    : positiveAmount(payload.amount, 'amount');
  return {
    kind, paymentMethod, externalReference, currencyCode,
    amount, cashOrBankNo, lines,
    description: shortString(payload.description, 'description', 250),
    referenceNo, noticeNo, collectorNo, commissionPercent, recipientName,
  };
}

function validateJournalRequestPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RequestError('Invalid payload');
  const externalReference = shortString(payload.externalReference, 'externalReference', 120);
  if (!/^[A-Za-z0-9:_-]+$/.test(externalReference)) throw new RequestError('Invalid externalReference');
  if (!Array.isArray(payload.lines) || payload.lines.length < 2 || payload.lines.length > 100) throw new RequestError('Invalid lines');
  return {
    externalReference,
    description: shortString(payload.description, 'description', 250),
    referenceNo: optionalString(payload.referenceNo, 'referenceNo', 30),
    lines: payload.lines.map((line, index) => {
      const direction = line?.direction;
      if (!['debit', 'credit'].includes(direction)) throw new RequestError(`Invalid lines[${index}].direction`);
      const analyticalType = Number(line.analyticalType);
      if (!Number.isSafeInteger(analyticalType) || analyticalType < 0) throw new RequestError(`Invalid lines[${index}].analyticalType`);
      const analyticalAccountCode = analyticalType === 0
        ? optionalString(line.analyticalAccountCode, `lines[${index}].analyticalAccountCode`, 30)
        : shortString(line.analyticalAccountCode, `lines[${index}].analyticalAccountCode`, 30);
      if (analyticalType === 0 && analyticalAccountCode !== null) {
        throw new RequestError(`Invalid lines[${index}].analyticalAccountCode`);
      }
      return {
        direction,
        currencyCode: shortString(line.currencyCode, `lines[${index}].currencyCode`, 7),
        amount: positiveAmount(line.amount, `lines[${index}].amount`),
        accountCode: shortString(line.accountCode, `lines[${index}].accountCode`, 30),
        analyticalAccountCode,
        analyticalType,
        description: optionalString(line.description, `lines[${index}].description`, 250),
      };
    }),
  };
}

function validateInventoryCountPayload(payload) {
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
      const expireDate = line?.expireDate === undefined || line?.expireDate === null || line?.expireDate === ''
        ? '1900-01-01' : shortString(line.expireDate, `lines[${index}].expireDate`, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expireDate)) throw new RequestError(`Invalid lines[${index}].expireDate`);
      return {
        itemCode: shortString(line?.itemCode, `lines[${index}].itemCode`, 30),
        unitCode: shortString(line?.unitCode, `lines[${index}].unitCode`, 10),
        warehouseCode,
        countedQuantity,
        batchNo: line?.batchNo === undefined || line?.batchNo === null || line?.batchNo === ''
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
        return json(response, 200, { status: 'ok', mode: 'IAS20191_DRAFT_INSERT_ONLY', schema: config.schema });
      }
      if (!authorized(request, config.apiKey)) return json(response, 401, { message: 'Unauthorized' });
      if (request.method === 'POST' && url.pathname === '/inventory/out-requests') {
        const result = await writer.createDraft(validatePayload(await body(request)));
        return json(response, result.created ? 201 : 200, result);
      }
      if (request.method === 'POST' && url.pathname === '/purchasing/requests/dry-run') {
        const result = await writer.dryRunPurchaseRequest(validatePurchaseRequestPayload(await body(request)));
        return json(response, 200, result);
      }
      if (request.method === 'POST' && url.pathname === '/purchasing/requests') {
        const result = await writer.createPurchaseRequestDraft(validatePurchaseRequestPayload(await body(request)));
        return json(response, result.created ? 201 : 200, result);
      }
      if (request.method === 'GET' && url.pathname === '/accounting/currencies') {
        return json(response, 200, await writer.listCurrencies());
      }
      if (request.method === 'POST' && url.pathname === '/accounting/vouchers/dry-run') {
        return json(response, 200, await writer.dryRunVoucherRequest(validateVoucherRequestPayload(await body(request))));
      }
      if (request.method === 'POST' && url.pathname === '/accounting/vouchers') {
        const result = await writer.createVoucherRequestDraft(validateVoucherRequestPayload(await body(request)));
        return json(response, result.created ? 201 : 200, result);
      }
      if (request.method === 'POST' && url.pathname === '/accounting/journals/dry-run') {
        return json(response, 200, await writer.dryRunJournalRequest(validateJournalRequestPayload(await body(request))));
      }
      if (request.method === 'POST' && url.pathname === '/accounting/journals') {
        const result = await writer.createJournalRequestDraft(validateJournalRequestPayload(await body(request)));
        return json(response, result.created ? 201 : 200, result);
      }
      if (request.method === 'POST' && url.pathname === '/inventory/counts/dry-run') {
        return json(response, 200, await writer.dryRunInventoryCount(validateInventoryCountPayload(await body(request))));
      }
      if (request.method === 'POST' && url.pathname === '/inventory/counts') {
        const result = await writer.createInventoryCountDraft(validateInventoryCountPayload(await body(request)));
        return json(response, result.created ? 201 : 200, result);
      }
      return json(response, 404, { message: 'Not found' });
    } catch (error) {
      if (error instanceof RequestError) return json(response, 400, { message: error.message });
      if (error instanceof OracleConflictError) return json(response, 409, { message: error.message, code: error.code });
      console.error('Oracle Write API request failed', { name: error.name, errorNum: error.errorNum });
      return json(response, 503, { message: 'Oracle draft-request write is temporarily unavailable' });
    }
  };
}

async function main() {
  const config = loadConfig();
  const writer = new OracleOutRequestWriter(oracledb, config);
  await writer.start();
  const server = http.createServer(createHandler(config, writer));
  server.listen(config.port, config.host, () => console.log(`Oracle Write API listening on http://${config.host}:${config.port}`));
  const shutdown = async () => { server.close(); await writer.close(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Oracle Write API failed to start', { name: error.name, message: error.message, errorNum: error.errorNum });
    process.exitCode = 1;
  });
}

module.exports = {
  RequestError, createHandler, validatePayload, validatePurchaseRequestPayload,
  validateVoucherRequestPayload, validateJournalRequestPayload, validateInventoryCountPayload,
};
