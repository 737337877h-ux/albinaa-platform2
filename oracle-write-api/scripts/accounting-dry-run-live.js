'use strict';

const oracledb = require('oracledb');
const { OracleOutRequestWriter } = require('../src/oracle-writer');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readOnlyConfig() {
  const user = required('ORACLE_USER').toUpperCase();
  const schema = required('ORACLE_SCHEMA').toUpperCase();
  if (user !== 'ALBINAA_RO') throw new Error('Accounting Dry Run must use ALBINAA_RO');
  if (schema !== 'IAS20191') throw new Error('Accounting Dry Run is pinned to IAS20191');
  return {
    schema,
    requestDate: '2020-12-31',
    oracle: {
      user,
      password: required('ORACLE_PASSWORD'),
      connectString: required('ORACLE_CONNECT_STRING'),
      clientLibDir: required('ORACLE_CLIENT_LIB_DIR'),
      poolMin: 1,
      poolMax: 1,
      poolIncrement: 1,
      queueTimeout: 5000,
      callTimeout: 15000,
    },
  };
}

async function main() {
  const config = readOnlyConfig();
  const writer = new OracleOutRequestWriter(oracledb, config);
  await writer.startReadOnly();
  try {
    const catalog = await writer.listCurrencies();
    const local = catalog.currencies.find((currency) => currency.local);
    const foreign = catalog.currencies.find((currency) => !currency.local);
    if (!local || !foreign) throw new Error('Both local and foreign IAS20191 currencies are required');
    const base = {
      externalReference: 'accounting-dry-run-live', kind: 'receipt', paymentMethod: 'cash',
      cashOrBankNo: 1, accountCode: '112101001', analyticalAccountCode: '20027',
      analyticalType: 3, description: 'Dry Run only', referenceNo: null, noticeNo: null,
      collectorNo: null, commissionPercent: null, recipientName: null,
    };
    const localVoucher = await writer.dryRunVoucherRequest({ ...base, currencyCode: local.code, amount: 150 });
    const foreignVoucher = await writer.dryRunVoucherRequest({ ...base, currencyCode: foreign.code, amount: 10000 });
    const journal = await writer.dryRunJournalRequest({
      externalReference: 'journal-dry-run-live', description: 'Dry Run only', referenceNo: null,
      lines: [
        { direction: 'debit', currencyCode: local.code, amount: 150, accountCode: '111202001', analyticalAccountCode: '2', analyticalType: 2, description: null },
        { direction: 'credit', currencyCode: local.code, amount: 150, accountCode: '112101001', analyticalAccountCode: '20031', analyticalType: 3, description: null },
      ],
    });
    console.log(JSON.stringify({ success: true, mode: 'DRY_RUN', oracleWrite: 'NONE', schema: config.schema, catalog, localVoucher, foreignVoucher, journal }, null, 2));
  } finally {
    await writer.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message, errorNum: error.errorNum ?? null }));
  process.exitCode = 1;
});
