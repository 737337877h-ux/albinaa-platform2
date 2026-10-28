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

function loadConfig(env = process.env) {
  const user = required(env, 'ORACLE_USER').toUpperCase();
  if (user !== 'ALBINAAWRITER') throw new Error('ORACLE_USER must be ALBINAAWRITER');
  const schema = required(env, 'ORACLE_SCHEMA').toUpperCase();
  if (schema !== 'IAS20191') throw new Error('ORACLE_SCHEMA must be the isolated IAS20191 test schema');
  const branchYear = positiveInteger(env, 'ORACLE_REQUEST_BRANCH_YEAR', 2019);
  if (branchYear !== 2019) throw new Error('ORACLE_REQUEST_BRANCH_YEAR must be 2019 for IAS20191');
  const requestDate = env.ORACLE_REQUEST_DATE?.trim() || '2020-12-31';
  if (!/^2020-12-31$/.test(requestDate)) throw new Error('ORACLE_REQUEST_DATE must be 2020-12-31 for this frozen test company');

  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port: positiveInteger(env, 'PORT', 3012),
    apiKey: required(env, 'ORACLE_WRITE_API_KEY'),
    schema,
    branchYear,
    requestDate,
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

module.exports = { loadConfig };
