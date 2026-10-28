'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const oracledb = require('oracledb');
const { loadIas20261PaymentConfig } = require('./ias20261-payment-config');
const { Ias20261PaymentConflictError, Ias20261PaymentWriter } = require('./ias20261-payment-reader');

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

function optionalString(value, name, maxLength) {
  if (value == null || value === '') return null;
  return shortString(value, name, maxLength);
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
  const raw = optionalString(value, name, 250);
  const normalized = raw && ['referenceNo', 'noticeNo'].includes(name) ? westernDigits(raw) : raw;
  if (normalized !== null && Buffer.byteLength(normalized, 'utf8') > maxBytes) {
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

function validatePaymentPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RequestError('Invalid payload');
  if (payload.kind !== 'payment') throw new RequestError('IAS20261 payment route accepts payment only');
  if (!['cash', 'bank_transfer'].includes(payload.paymentMethod)) throw new RequestError('Invalid paymentMethod');
  const externalReference = shortString(payload.externalReference, 'externalReference', 120);
  if (!/^[A-Za-z0-9:_-]+$/.test(externalReference)) throw new RequestError('Invalid externalReference');
  const currencyCode = shortString(payload.currencyCode, 'currencyCode', 7);
  const cashOrBankNo = Number(payload.cashOrBankNo);
  if (!Number.isSafeInteger(cashOrBankNo) || cashOrBankNo < 1) throw new RequestError('Invalid cashOrBankNo');
  const referenceNo = optionalOracleString(payload.referenceNo, 'referenceNo', 15);
  const noticeNo = optionalOracleString(payload.noticeNo, 'noticeNo', 30);
  const recipientName = optionalOracleString(payload.recipientName, 'recipientName', 150);
  if (!recipientName) throw new RequestError('recipientName is required for payment');
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
    kind: 'payment',
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

function createHandler(config, writer) {
  return async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (request.method === 'GET' && url.pathname === '/health') {
        return json(response, 200, {
          status: 'ok', mode: 'IAS20261_PAYMENT_DRAFT_INSERT_ONLY', schema: config.schema,
        });
      }
      if (!authorized(request, config.apiKey)) return json(response, 401, { message: 'Unauthorized' });
      if (request.method === 'POST' && url.pathname === '/accounting/payments/dry-run') {
        return json(response, 200, await writer.dryRun(validatePaymentPayload(await body(request))));
      }
      if (request.method === 'POST' && url.pathname === '/accounting/payments') {
        const result = await writer.createDraft(validatePaymentPayload(await body(request)));
        return json(response, result.created ? 201 : 200, result);
      }
      return json(response, 404, { message: 'Not found' });
    } catch (error) {
      if (error instanceof RequestError) return json(response, 400, { message: error.message });
      if (error instanceof Ias20261PaymentConflictError) {
        return json(response, 409, { message: error.message, code: error.code });
      }
      console.error('IAS20261 Payment Draft API request failed', { name: error.name, errorNum: error.errorNum });
      return json(response, 503, { message: 'بوابة مسودات سند الصرف IAS20261 غير متاحة مؤقتًا' });
    }
  };
}

async function main() {
  const config = loadIas20261PaymentConfig();
  const writer = new Ias20261PaymentWriter(oracledb, config);
  await writer.start();
  const server = http.createServer(createHandler(config, writer));
  server.listen(config.port, config.host, () => {
    console.log(`IAS20261 Payment Draft API listening on http://${config.host}:${config.port}`);
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
    console.error('IAS20261 Payment Draft API failed to start', {
      name: error.name, message: error.message, errorNum: error.errorNum,
    });
    process.exitCode = 1;
  });
}

module.exports = { RequestError, createHandler, validatePaymentPayload };
