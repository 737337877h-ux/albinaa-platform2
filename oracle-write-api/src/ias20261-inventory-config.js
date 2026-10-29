'use strict';

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

function loadIas20261InventoryConfig(env = process.env) {
  const user = required(env, 'ORACLE_USER').toUpperCase();
  if (user !== 'ALBINAA20261INVWRITER') throw new Error('ORACLE_USER must be ALBINAA20261INVWRITER');
  const schema = required(env, 'ORACLE_SCHEMA').toUpperCase();
  if (schema !== 'IAS20261') throw new Error('ORACLE_SCHEMA must be IAS20261');
  const branchYear = positiveInteger(env, 'ORACLE_REQUEST_BRANCH_YEAR', 2026);
  if (branchYear !== 2026) throw new Error('ORACLE_REQUEST_BRANCH_YEAR must be 2026');

  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port: positiveInteger(env, 'PORT', 13217),
    apiKey: required(env, 'ORACLE_WRITE_API_KEY'),
    schema,
    branchYear,
    oracleUserId: positiveInteger(env, 'ORACLE_AD_USER_ID', 1),
    oracle: {
      user,
      password: required(env, 'ORACLE_PASSWORD'),
      connectString: required(env, 'ORACLE_CONNECT_STRING'),
      clientLibDir: required(env, 'ORACLE_CLIENT_LIB_DIR'),
      poolMin: positiveInteger(env, 'ORACLE_POOL_MIN', 1),
      poolMax: positiveInteger(env, 'ORACLE_POOL_MAX', 2),
      poolIncrement: positiveInteger(env, 'ORACLE_POOL_INCREMENT', 1),
      queueTimeout: positiveInteger(env, 'ORACLE_QUEUE_TIMEOUT_MS', 5000),
      callTimeout: positiveInteger(env, 'ORACLE_CALL_TIMEOUT_MS', 15000),
    },
  };
}

module.exports = { loadIas20261InventoryConfig };
