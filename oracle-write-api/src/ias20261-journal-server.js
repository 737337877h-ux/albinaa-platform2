'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const oracledb = require('oracledb');
const { loadIas20261JournalConfig } = require('./ias20261-journal-config');
const { Ias20261JournalConflictError, Ias20261JournalWriter } = require('./ias20261-journal-writer');

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

function positiveAmount(value, name) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000) {
    throw new RequestError(`Invalid ${name}`);
  }
  return amount;
}

function validateJournalPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RequestError('Invalid payload');
  const externalReference = shortString(payload.externalReference, 'externalReference', 120);
  if (!/^[A-Za-z0-9:_-]+$/.test(externalReference)) throw new RequestError('Invalid externalReference');
  if (!Array.isArray(payload.lines) || payload.lines.length < 2 || payload.lines.length > 100) {
    throw new RequestError('Invalid lines');
  }
  const description = shortString(payload.description, 'description', 250);
  const lines = payload.lines.map((line, index) => {
    if (!['debit', 'credit'].includes(line?.direction)) {
      throw new RequestError(`Invalid lines[${index}].direction`);
    }
    const analyticalType = Number(line?.analyticalType);
    if (!Number.isSafeInteger(analyticalType) || analyticalType < 0) {
      throw new RequestError(`Invalid lines[${index}].analyticalType`);
    }
    const analyticalAccountCode = analyticalType === 0
      ? optionalString(line.analyticalAccountCode, `lines[${index}].analyticalAccountCode`, 30)
      : shortString(line.analyticalAccountCode, `lines[${index}].analyticalAccountCode`, 30);
    if (analyticalType === 0 && analyticalAccountCode !== null) {
      throw new RequestError(`Invalid lines[${index}].analyticalAccountCode`);
    }
    return {
      direction: line.direction,
      currencyCode: shortString(line.currencyCode, `lines[${index}].currencyCode`, 7),
      amount: positiveAmount(line.amount, `lines[${index}].amount`),
      accountCode: shortString(line.accountCode, `lines[${index}].accountCode`, 30),
      analyticalAccountCode,
      analyticalType,
      description: optionalString(line.description, `lines[${index}].description`, 250) || description,
    };
  });
  if (!lines.some((line) => line.direction === 'debit') || !lines.some((line) => line.direction === 'credit')) {
    throw new RequestError('Journal must include debit and credit lines');
  }
  return {
    externalReference,
    description,
    referenceNo: optionalString(payload.referenceNo, 'referenceNo', 30),
    lines,
  };
}

function createHandler(config, writer) {
  return async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (request.method === 'GET' && url.pathname === '/health') {
        return json(response, 200, {
          status: 'ok', mode: 'IAS20261_JOURNAL_DRAFT_INSERT_ONLY', schema: config.schema,
        });
      }
      if (!authorized(request, config.apiKey)) return json(response, 401, { message: 'Unauthorized' });
      if (request.method === 'POST' && url.pathname === '/accounting/journals/dry-run') {
        return json(response, 200, await writer.dryRun(validateJournalPayload(await body(request))));
      }
      if (request.method === 'POST' && url.pathname === '/accounting/journals') {
        const result = await writer.createDraft(validateJournalPayload(await body(request)));
        return json(response, result.created ? 201 : 200, result);
      }
      return json(response, 404, { message: 'Not found' });
    } catch (error) {
      if (error instanceof RequestError) return json(response, 400, { message: error.message });
      if (error instanceof Ias20261JournalConflictError) {
        return json(response, 409, { message: error.message, code: error.code });
      }
      console.error('IAS20261 Journal Draft API request failed', { name: error.name, errorNum: error.errorNum });
      return json(response, 503, { message: 'بوابة مسودات القيد اليومي IAS20261 غير متاحة مؤقتًا' });
    }
  };
}

async function main() {
  const config = loadIas20261JournalConfig();
  const writer = new Ias20261JournalWriter(oracledb, config);
  await writer.start();
  const server = http.createServer(createHandler(config, writer));
  server.listen(config.port, config.host, () => {
    console.log(`IAS20261 Journal Draft API listening on http://${config.host}:${config.port}`);
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
    console.error('IAS20261 Journal Draft API failed to start', {
      name: error.name, message: error.message, errorNum: error.errorNum,
    });
    process.exitCode = 1;
  });
}

module.exports = { RequestError, createHandler, validateJournalPayload };
