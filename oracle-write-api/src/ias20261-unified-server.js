'use strict';

const http = require('node:http');
const oracledb = require('oracledb');
const { loadIas20261UnifiedConfig } = require('./ias20261-unified-config');
const { Ias20261PurchaseWriter } = require('./ias20261-purchase-writer');
const { Ias20261ReceiptWriter } = require('./ias20261-receipt-writer');
const { Ias20261TransferWriter } = require('./ias20261-transfer-writer');
const { Ias20261PaymentWriter } = require('./ias20261-payment-reader');
const { Ias20261JournalWriter } = require('./ias20261-journal-writer');
const { Ias20261InventoryWriter } = require('./ias20261-inventory-writer');
const { createHandler: createPurchaseHandler } = require('./ias20261-purchase-server');
const { createHandler: createPaymentHandler } = require('./ias20261-payment-server');
const { createHandler: createJournalHandler } = require('./ias20261-journal-server');
const { createHandler: createInventoryHandler } = require('./ias20261-inventory-server');
const { Ias20261QuotationWriter } = require('./ias20261-quotation-writer');
const { createQuotationHandler } = require('./ias20261-quotation-server');
const { Ias20261SalesOrderWriter } = require('./ias20261-sales-order-writer');
const { createSalesOrderHandler } = require('./ias20261-sales-order-server');

const COMPONENTS = Object.freeze([
  'receipts', 'payments', 'journals', 'inventory-counts', 'inventory-transfers', 'purchase-requests',
]);

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function createUnifiedHandler(config, handlers) {
  return (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json(response, 200, {
        status: 'ok', mode: 'IAS20261_UNIFIED_DRAFT_INSERT_ONLY', schema: config.schema,
        components: [...COMPONENTS, ...(handlers.quotation ? ['quotations'] : []), ...(handlers.salesOrder ? ['customer-orders'] : [])],
      });
    }
    if (url.pathname.startsWith('/accounting/receipts')
        || url.pathname.startsWith('/inventory/out-requests')
        || url.pathname.startsWith('/purchasing/requests')) {
      return handlers.purchase(request, response);
    }
    if (url.pathname.startsWith('/accounting/payments')) return handlers.payment(request, response);
    if (url.pathname.startsWith('/accounting/journals')) return handlers.journal(request, response);
    if (url.pathname.startsWith('/inventory/counts')) return handlers.inventory(request, response);
    if (url.pathname.startsWith('/sales/quotations') && handlers.quotation) return handlers.quotation(request, response);
    if (url.pathname.startsWith('/sales/customer-orders') && handlers.salesOrder) return handlers.salesOrder(request, response);
    return json(response, 404, { message: 'Not found' });
  };
}

async function main() {
  const config = loadIas20261UnifiedConfig();
  const writers = {
    purchase: new Ias20261PurchaseWriter(oracledb, config.purchase),
    transfer: new Ias20261TransferWriter(oracledb, config.purchase),
    receipt: new Ias20261ReceiptWriter(oracledb, config.purchase),
    payment: new Ias20261PaymentWriter(oracledb, config.payment),
    journal: new Ias20261JournalWriter(oracledb, config.journal),
    inventory: new Ias20261InventoryWriter(oracledb, config.inventory),
  };
  const orderedWriters = Object.values(writers);
  const started = [];
  try {
    for (const writer of orderedWriters) {
      await writer.start();
      started.push(writer);
    }
  } catch (error) {
    await Promise.allSettled(started.map((writer) => writer.close()));
    throw error;
  }

  const handlers = {
    ...(process.env.ORACLE_SALES_ORDERS_WRITE_ENABLED === 'true' ? {
      salesOrder: createSalesOrderHandler(config.purchase, new Ias20261SalesOrderWriter(writers.purchase.pool, config.purchase)),
    } : {}),
    purchase: createPurchaseHandler(config.purchase, writers.purchase, writers.transfer, writers.receipt),
    payment: createPaymentHandler(config.payment, writers.payment),
    journal: createJournalHandler(config.journal, writers.journal),
    inventory: createInventoryHandler(config.inventory, writers.inventory),
    ...(process.env.ORACLE_QUOTATIONS_WRITE_ENABLED === 'true' ? {
      quotation: createQuotationHandler(config.purchase, new Ias20261QuotationWriter(writers.purchase.pool, config.purchase)),
    } : {}),
  };
  const server = http.createServer(createUnifiedHandler(config, handlers));
  server.listen(config.port, config.host, () => {
    console.log(`IAS20261 Unified Draft Write API listening on http://${config.host}:${config.port}`);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    await Promise.allSettled(orderedWriters.map((writer) => writer.close()));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('IAS20261 Unified Draft Write API failed to start', {
      name: error.name, message: error.message, errorNum: error.errorNum,
    });
    process.exitCode = 1;
  });
}

module.exports = { COMPONENTS, createUnifiedHandler };
