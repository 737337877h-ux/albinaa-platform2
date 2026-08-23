'use strict';

const ORACLE_IDENTIFIER = /^[A-Z][A-Z0-9_$#]{0,29}$/;

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

function schemaName(value) {
  const normalized = value.trim().toUpperCase();
  if (!ORACLE_IDENTIFIER.test(normalized)) throw new Error(`Invalid Oracle schema: ${value}`);
  return normalized;
}

function loadConfig(env = process.env) {
  const user = required(env, 'ORACLE_USER').toUpperCase();
  if (user !== 'ALBINAA_RO') throw new Error('ORACLE_USER must be ALBINAA_RO');
  const defaultSchema = schemaName(env.ORACLE_SCHEMA || 'IAS20261');
  const allowedSchemas = new Set((env.ORACLE_ALLOWED_SCHEMAS || defaultSchema)
    .split(',').map(schemaName));
  if (!allowedSchemas.has(defaultSchema)) throw new Error('ORACLE_SCHEMA must be included in ORACLE_ALLOWED_SCHEMAS');

  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port: positiveInteger(env, 'PORT', 3011),
    oracle: {
      user,
      password: env.ORACLE_PASSWORD_BASE64
        ? Buffer.from(env.ORACLE_PASSWORD_BASE64.trim(), 'base64').toString('utf8')
        : required(env, 'ORACLE_PASSWORD'),
      connectString: required(env, 'ORACLE_CONNECT_STRING'),
      clientLibDir: required(env, 'ORACLE_CLIENT_LIB_DIR'),
      defaultSchema,
      allowedSchemas,
      poolMin: positiveInteger(env, 'ORACLE_POOL_MIN', 1),
      poolMax: positiveInteger(env, 'ORACLE_POOL_MAX', 4),
      poolIncrement: positiveInteger(env, 'ORACLE_POOL_INCREMENT', 1),
      queueTimeout: positiveInteger(env, 'ORACLE_QUEUE_TIMEOUT_MS', 5000),
      queryTimeout: positiveInteger(env, 'ORACLE_QUERY_TIMEOUT_MS', 10000),
    },
    apiKey: required(env, 'ORACLE_READ_API_KEY'),
  };
}

function resolveSchema(config, requestedSchema) {
  const schema = requestedSchema ? schemaName(requestedSchema) : config.oracle.defaultSchema;
  if (!config.oracle.allowedSchemas.has(schema)) throw new Error('Oracle schema is not allowed');
  return schema;
}

module.exports = { loadConfig, resolveSchema, schemaName };
