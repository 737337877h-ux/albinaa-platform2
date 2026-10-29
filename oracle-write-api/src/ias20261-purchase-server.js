'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const oracledb = require('oracledb');
const { loadIas20261PurchaseConfig } = require('./ias20261-purchase-config');
const { Ias20261PurchaseWriter } = require('./ias20261-purchase-writer');
const { Ias20261ReceiptConflictError, Ias20261ReceiptWriter } = require('./ias20261-receipt-writer');
const { Ias20261TransferWriter } = require('./ias20261-transfer-writer');

class RequestError extends Error {}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
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
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new RequestError(`Invalid ${name}`);
  }
  return value.trim();
}

function optionalString(value, name, maxLength) {
  return typeof value === 'string' && value.trim() ? shortString(value, name, maxLength) : null;
}

function westernDigits(value) {
  const digits = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  };
  return value.replace(/[٠-٩۰-۹]/g, (digit) => digits[digit] || digit);
}

function optionalOracleString(value, name, maxBytes) {
  const raw = optionalString(value, name, maxBytes);
  const normalized = raw && ['referenceNo', 'noticeNo'].includes(name) ? westernDigits(raw) : raw;
  if (normalized && Buffer.byteLength(normalized, 'utf8') > maxBytes) {
    const label = name === 'referenceNo' ? 'رقم المرجع'
      : name === 'noticeNo' ? 'رقم الإشعار'
        : name === 'recipientName' ? 'اسم المستلم' : name;
    throw new RequestError(`${label} يتجاوز حد Oracle (${maxBytes} بايت)`);
  }
  return normalized;
}

function positiveAmount(value, name) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000) {
    throw new RequestError(`Invalid ${name}`);
  }
  return amount;
}

function adenDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Aden', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function validatePurchasePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RequestError('Invalid payload');
  const externalReference = shortString(payload.externalReference, 'externalReference', 120);
  if (!/^[A-Za-z0-9:_-]+$/.test(externalReference)) throw new RequestError('Invalid externalReference');
  const warehouseCode = shortString(String(payload.warehouseCode ?? ''), 'warehouseCode', 10);
  if (!/^\d+$/.test(warehouseCode)) throw new RequestError('Invalid warehouseCode');
  const requiredDate = payload.requiredDate == null || payload.requiredDate === ''
    ? adenDate() : shortString(payload.requiredDate, 'requiredDate', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requiredDate)) throw new RequestError('Invalid requiredDate');
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 50) {
    throw new RequestError('Invalid lines');
  }
  const lines = payload.lines.map((line, index) => {
    const itemCode = shortString(line?.itemCode, `lines[${index}].itemCode`, 30);
    const unitCode = shortString(line?.unitCode, `lines[${index}].unitCode`, 10);
    const quantity = Number(line?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000_000) {
      throw new RequestError(`Invalid lines[${index}].quantity`);
    }
    return { itemCode, unitCode, quantity };
  });
  return {
    externalReference,
    warehouseCode: Number(warehouseCode),
    requiredDate,
    requestSide: typeof payload.requestSide === 'string' && payload.requestSide.trim()
      ? shortString(payload.requestSide, 'requestSide', 60) : 'منصة البناء الراقي',
    notes: typeof payload.notes === 'string' && payload.notes.trim()
      ? shortString(payload.notes, 'notes', 250) : 'طلب شراء من منصة البناء الراقي',
    lines,
  };
}

function validateTransferPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RequestError('Invalid payload');
  const externalReference = shortString(payload.externalReference, 'externalReference', 120);
  if (!/^[A-Za-z0-9:_-]+$/.test(externalReference)) throw new RequestError('Invalid externalReference');
  const sourceWarehouseCode = shortString(String(payload.sourceWarehouseCode ?? ''), 'sourceWarehouseCode', 10);
  const destinationWarehouseCode = shortString(String(payload.destinationWarehouseCode ?? ''), 'destinationWarehouseCode', 10);
  if (!/^\d+$/.test(sourceWarehouseCode) || !/^\d+$/.test(destinationWarehouseCode)
      || sourceWarehouseCode === destinationWarehouseCode) {
    throw new RequestError('Invalid transfer warehouses');
  }
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 50) {
    throw new RequestError('Invalid lines');
  }
  const lines = payload.lines.map((line, index) => {
    const itemCode = shortString(line?.itemCode, `lines[${index}].itemCode`, 30);
    const unitCode = shortString(line?.unitCode, `lines[${index}].unitCode`, 10);
    const quantity = Number(line?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000_000) {
      throw new RequestError(`Invalid lines[${index}].quantity`);
    }
    return { itemCode, unitCode, quantity };
  });
  return {
    externalReference,
    sourceWarehouseCode: Number(sourceWarehouseCode),
    destinationWarehouseCode: Number(destinationWarehouseCode),
    requestSide: typeof payload.requestSide === 'string' && payload.requestSide.trim()
      ? shortString(payload.requestSide, 'requestSide', 60) : 'منصة البناء الراقي',
    notes: typeof payload.notes === 'string' && payload.notes.trim()
      ? shortString(payload.notes, 'notes', 250) : 'طلب تحويل مخزني من منصة البناء الراقي',
    lines,
  };
}

function validateReceiptPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RequestError('Invalid payload');
  if (payload.kind !== 'receipt') throw new RequestError('IAS20261 receipt route accepts receipt only');
  if (!['cash', 'bank_transfer'].includes(payload.paymentMethod)) throw new RequestError('Invalid paymentMethod');
  const externalReference = shortString(payload.externalReference, 'externalReference', 120);
  if (!/^[A-Za-z0-9:_-]+$/.test(externalReference)) throw new RequestError('Invalid externalReference');
  const currencyCode = shortString(payload.currencyCode, 'currencyCode', 7);
  const cashOrBankNo = Number(payload.cashOrBankNo);
  if (!Number.isSafeInteger(cashOrBankNo) || cashOrBankNo < 1) throw new RequestError('Invalid cashOrBankNo');
  // IAS_RQ_VCHR_MST.REF_NO is VARCHAR2(15 BYTE), while
  // IAS_RQ_VCHR_DTL.NOTE_NO is VARCHAR2(30 BYTE). Validate those real Oracle
  // limits before Dry Run can report that a draft is saveable.
  const referenceNo = optionalOracleString(payload.referenceNo, 'referenceNo', 15);
  const noticeNo = optionalOracleString(payload.noticeNo, 'noticeNo', 30);
  const recipientName = optionalOracleString(payload.recipientName, 'recipientName', 150);
  if (!recipientName) throw new RequestError('recipientName is required for receipt');
  const collectorNo = payload.collectorNo == null || payload.collectorNo === '' ? null : Number(payload.collectorNo);
  const commissionPercent = payload.commissionPercent == null || payload.commissionPercent === ''
    ? null : Number(payload.commissionPercent);
  if (collectorNo !== null && (!Number.isSafeInteger(collectorNo) || collectorNo < 1)) {
    throw new RequestError('Invalid collectorNo');
  }
  if (commissionPercent !== null
      && (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100)) {
    throw new RequestError('Invalid commissionPercent');
  }
  if (payload.paymentMethod === 'bank_transfer' && (!noticeNo || !referenceNo)) {
    throw new RequestError('referenceNo and noticeNo are required for bank transfer');
  }
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 20) {
    throw new RequestError('Invalid lines');
  }
  const description = shortString(payload.description, 'description', 250);
  const lines = payload.lines.map((line, index) => {
    const analyticalType = Number(line?.analyticalType);
    if (!Number.isSafeInteger(analyticalType) || analyticalType < 1) {
      throw new RequestError(`Invalid lines[${index}].analyticalType`);
    }
    return {
      amount: positiveAmount(line?.amount, `lines[${index}].amount`),
      currencyCode: shortString(line?.currencyCode || currencyCode, `lines[${index}].currencyCode`, 7),
      accountCode: shortString(line?.accountCode, `lines[${index}].accountCode`, 30),
      analyticalAccountCode: shortString(line?.analyticalAccountCode, `lines[${index}].analyticalAccountCode`, 30),
      analyticalType,
      description: optionalString(line?.description, `lines[${index}].description`, 250) || description,
    };
  });
  return {
    kind: 'receipt',
    paymentMethod: payload.paymentMethod,
    externalReference,
    currencyCode,
    amount: positiveAmount(payload.amount, 'amount'),
    cashOrBankNo,
    lines,
    description,
    referenceNo,
    noticeNo,
    collectorNo,
    commissionPercent,
    recipientName,
  };
}

function createHandler(config, writer, transferWriter = null, receiptWriter = null) {
  return async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (request.method === 'GET' && url.pathname === '/health') {
        return json(response, 200, {
          status: 'ok', mode: receiptWriter
            ? 'IAS20261_PURCHASE_TRANSFER_RECEIPT_DRAFT_INSERT_ONLY'
            : transferWriter
              ? 'IAS20261_PURCHASE_TRANSFER_DRAFT_INSERT_ONLY'
              : 'IAS20261_PURCHASE_DRAFT_INSERT_ONLY', schema: config.schema,
        });
      }
      if (!authorized(request, config.apiKey)) return json(response, 401, { message: 'Unauthorized' });
      if (request.method === 'POST' && url.pathname === '/purchasing/requests/dry-run') {
        return json(response, 200, await writer.dryRun(validatePurchasePayload(await body(request))));
      }
      if (request.method === 'POST' && url.pathname === '/purchasing/requests') {
        const result = await writer.createDraft(validatePurchasePayload(await body(request)));
        return json(response, result.created ? 201 : 200, result);
      }
      if (transferWriter && request.method === 'POST' && url.pathname === '/inventory/out-requests/dry-run') {
        return json(response, 200, await transferWriter.dryRun(validateTransferPayload(await body(request))));
      }
      if (transferWriter && request.method === 'POST' && url.pathname === '/inventory/out-requests') {
        const result = await transferWriter.createDraft(validateTransferPayload(await body(request)));
        return json(response, result.created ? 201 : 200, result);
      }
      if (receiptWriter && request.method === 'POST' && url.pathname === '/accounting/receipts/dry-run') {
        return json(response, 200, await receiptWriter.dryRun(validateReceiptPayload(await body(request))));
      }
      if (receiptWriter && request.method === 'POST' && url.pathname === '/accounting/receipts') {
        const result = await receiptWriter.createDraft(validateReceiptPayload(await body(request)));
        return json(response, result.created ? 201 : 200, result);
      }
      return json(response, 404, { message: 'Not found' });
    } catch (error) {
      if (error instanceof RequestError) return json(response, 400, { message: error.message });
      if (error instanceof Ias20261ReceiptConflictError) {
        return json(response, 409, { message: error.message, code: error.code });
      }
      console.error('IAS20261 Draft Write API request failed', { name: error.name, errorNum: error.errorNum });
      return json(response, 503, { message: 'بوابة مسودات IAS20261 غير متاحة مؤقتًا' });
    }
  };
}

async function main() {
  const config = loadIas20261PurchaseConfig();
  const writer = new Ias20261PurchaseWriter(oracledb, config);
  const transferWriter = new Ias20261TransferWriter(oracledb, config);
  const receiptWriter = new Ias20261ReceiptWriter(oracledb, config);
  await writer.start();
  await transferWriter.start();
  await receiptWriter.start();
  const server = http.createServer(createHandler(config, writer, transferWriter, receiptWriter));
  server.listen(config.port, config.host, () => {
    console.log(`IAS20261 Draft Write API listening on http://${config.host}:${config.port}`);
  });
  const shutdown = async () => {
    server.close();
    await Promise.all([writer.close(), transferWriter.close(), receiptWriter.close()]);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('IAS20261 Draft Write API failed to start', {
      name: error.name, message: error.message, errorNum: error.errorNum,
    });
    process.exitCode = 1;
  });
}

module.exports = {
  RequestError, createHandler, validatePurchasePayload, validateReceiptPayload, validateTransferPayload,
};
