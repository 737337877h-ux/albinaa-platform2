'use strict';

// Read-only discovery for the Oracle INVI008 item-information screen.
// This script intentionally inspects metadata only; it never executes DML.

const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

async function main() {
  const config = loadConfig();
  const schema = config.oracle.defaultSchema;
  const database = new OracleReadPool(oracledb, config.oracle);
  await database.start();

  try {
    const core = await database.select(`SELECT TABLE_NAME, COLUMN_ID, COLUMN_NAME, DATA_TYPE,
       DATA_PRECISION, DATA_SCALE, NULLABLE
FROM ALL_TAB_COLUMNS
WHERE OWNER = :owner
  AND TABLE_NAME IN ('ITEM_DETAILS', 'ITEM_MOVEMENT', 'IAS_ITEM_PRICE', 'IAS_PRICING_LEVELS')
ORDER BY TABLE_NAME, COLUMN_ID`, { owner: schema });

    const candidates = await database.select(`SELECT * FROM (
  SELECT DISTINCT C.TABLE_NAME
  FROM ALL_TAB_COLUMNS C
  WHERE C.OWNER = :owner
    AND EXISTS (
      SELECT 1 FROM ALL_TAB_COLUMNS I
      WHERE I.OWNER = C.OWNER AND I.TABLE_NAME = C.TABLE_NAME AND I.COLUMN_NAME = 'I_CODE'
    )
    AND (
      C.COLUMN_NAME LIKE '%PRICE%'
      OR C.COLUMN_NAME LIKE '%SALE%'
      OR C.COLUMN_NAME IN ('I_PRICE', 'ITM_PRICE', 'AVG_PRICE', 'LAST_PRICE')
    )
    AND (
      C.TABLE_NAME LIKE '%ITEM%'
      OR C.TABLE_NAME LIKE '%ITM%'
      OR C.TABLE_NAME LIKE '%PRICE%'
      OR C.TABLE_NAME LIKE '%SALE%'
      OR C.TABLE_NAME = 'ITEM_MOVEMENT'
    )
  ORDER BY C.TABLE_NAME
) WHERE ROWNUM <= 80`, { owner: schema });

    const viewDefinitions = await database.select(`SELECT VIEW_NAME, TEXT
FROM ALL_VIEWS
WHERE OWNER = :owner AND VIEW_NAME = 'IAS_V_ITM_AVLQTY'`, { owner: schema });

    const candidateNames = candidates.rows.map((row) => row.TABLE_NAME);
    let candidateColumns = [];
    if (candidateNames.length > 0) {
      const binds = { owner: schema };
      const placeholders = candidateNames.map((name, index) => {
        binds[`table${index}`] = name;
        return `:table${index}`;
      });
      const columns = await database.select(`SELECT TABLE_NAME, COLUMN_ID, COLUMN_NAME, DATA_TYPE,
       DATA_PRECISION, DATA_SCALE, NULLABLE
FROM ALL_TAB_COLUMNS
WHERE OWNER = :owner
  AND TABLE_NAME IN (${placeholders.join(', ')})
ORDER BY TABLE_NAME, COLUMN_ID`, binds);
      candidateColumns = columns.rows;
    }

    process.stdout.write(`${JSON.stringify({
      schema,
      sessionUser: config.oracle.user,
      mode: 'SELECT_ONLY_METADATA',
      coreColumns: core.rows,
      candidateTables: candidateNames,
      candidateColumns,
      viewDefinitions: viewDefinitions.rows,
    }, null, 2)}\n`);
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
