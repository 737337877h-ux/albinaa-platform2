'use strict';

const { loadIas20261PurchaseConfig } = require('./ias20261-purchase-config');
const { loadIas20261PaymentConfig } = require('./ias20261-payment-config');
const { loadIas20261JournalConfig } = require('./ias20261-journal-config');
const { loadIas20261InventoryConfig } = require('./ias20261-inventory-config');

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(env, name, fallback) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function writerEnv(env, user, passwordName, port) {
  return {
    ...env,
    HOST: env.HOST?.trim() || '127.0.0.1',
    PORT: String(port),
    ORACLE_USER: user,
    ORACLE_PASSWORD: required(env, passwordName),
  };
}

function loadIas20261UnifiedConfig(env = process.env) {
  const port = positiveInteger(env, 'PORT', 13014);
  const apiKey = required(env, 'ORACLE_WRITE_API_KEY');
  const common = { ...env, PORT: String(port), ORACLE_WRITE_API_KEY: apiKey };

  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port,
    apiKey,
    schema: 'IAS20261',
    purchase: loadIas20261PurchaseConfig(writerEnv(
      common, 'ALBINAA20261WRITER', 'ORACLE_PURCHASE_RECEIPT_TRANSFER_PASSWORD', port,
    )),
    payment: loadIas20261PaymentConfig(writerEnv(
      common, 'ALBINAA20261PAYWRITER', 'ORACLE_PAYMENT_PASSWORD', port,
    )),
    journal: loadIas20261JournalConfig(writerEnv(
      common, 'ALBINAA20261JRNWRITER', 'ORACLE_JOURNAL_PASSWORD', port,
    )),
    inventory: loadIas20261InventoryConfig(writerEnv(
      common, 'ALBINAA20261INVWRITER', 'ORACLE_INVENTORY_PASSWORD', port,
    )),
  };
}

module.exports = { loadIas20261UnifiedConfig };
