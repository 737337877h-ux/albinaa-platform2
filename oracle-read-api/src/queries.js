'use strict';

function warehouseExists(schema) {
  return `SELECT 1 AS FOUND FROM ${schema}.WAREHOUSE_DETAILS WHERE W_CODE = :warehouseCode AND ROWNUM = 1`;
}

function stock(schema) {
  return {
    itemExists: `SELECT 1 AS FOUND FROM ${schema}.ITEM_DETAILS
WHERE I_CODE = :itemCode AND ROWNUM = 1`,
    unit: `SELECT I_CODE AS ITEM_CODE, ITM_UNT AS UNIT_CODE, P_SIZE AS PACKAGE_SIZE
FROM ${schema}.ITEM_DETAILS
WHERE I_CODE = :itemCode AND ITM_UNT = :unitCode AND ROWNUM = 1`,
    available: `SELECT NVL(SUM(AVL_QTY), 0) AS AVAILABLE_QUANTITY
FROM ${schema}.IAS_V_ITM_AVLQTY
WHERE I_CODE = :itemCode AND W_CODE = :warehouseCode AND ITM_UNT = :unitCode`,
  };
}

function transferEvidence(schema, itemCodes) {
  const uniqueItems = [...new Set(itemCodes.map((code) => code.trim()).filter(Boolean))];
  if (uniqueItems.length === 0) throw new Error('At least one itemCode is required');
  if (uniqueItems.length > 200) throw new Error('At most 200 itemCodes are allowed');
  const itemBinds = Object.fromEntries(uniqueItems.map((code, index) => [`item${index}`, code]));
  const itemList = uniqueItems.map((_, index) => `:item${index}`).join(', ');
  return {
    source: `SELECT TO_CHAR(TR_SER, 'FM99999999999999999999') AS TRANSFER_SERIAL,
       TO_CHAR(TR_NO, 'FM99999999999999999999') AS TRANSFER_DOCUMENT_NUMBER,
       TO_CHAR(W_CODE) AS WAREHOUSE_CODE, TO_CHAR(T_W_CODE) AS DESTINATION_WAREHOUSE_CODE,
       TR_POST, STK_PROCESSED, TO_CHAR(POST_DATE, 'YYYY-MM-DD HH24:MI:SS') AS POST_DATE
FROM ${schema}.IAS_WHTRNS_MST
WHERE TR_SER = :sourceTransferSerial
  AND W_CODE = :sourceWarehouseCode
  AND T_W_CODE = :destinationWarehouseCode`,
    destinations: `SELECT TO_CHAR(TR_SER, 'FM99999999999999999999') AS TRANSFER_SERIAL,
       TO_CHAR(F_TR_SER, 'FM99999999999999999999') AS SOURCE_TRANSFER_SERIAL,
       TO_CHAR(W_CODE) AS WAREHOUSE_CODE
FROM ${schema}.IAS_WHTRNS_MST
WHERE F_TR_SER = :sourceTransferSerial
  AND TR_SER <> :sourceTransferSerial
  AND W_CODE = :destinationWarehouseCode`,
    movements: `SELECT TO_CHAR(DOC_SER, 'FM99999999999999999999') AS DOCUMENT_SERIAL,
       DOC_TYPE AS DOCUMENT_TYPE, I_CODE AS ITEM_CODE, TO_CHAR(W_CODE) AS WAREHOUSE_CODE
FROM ${schema}.ITEM_MOVEMENT
WHERE I_CODE IN (${itemList})
  AND DOC_TYPE IN (7, 8)
  AND (DOC_SER = :sourceTransferSerial OR DOC_SER IN (
    SELECT TR_SER FROM ${schema}.IAS_WHTRNS_MST
    WHERE F_TR_SER = :sourceTransferSerial AND TR_SER <> :sourceTransferSerial
  ))`,
    itemBinds,
  };
}

function compatibility(schema) {
  const required = {
    WAREHOUSE_DETAILS: ['W_CODE'],
    ITEM_DETAILS: ['I_CODE', 'ITM_UNT', 'P_SIZE'],
    IAS_V_ITM_AVLQTY: ['I_CODE', 'W_CODE', 'ITM_UNT', 'AVL_QTY'],
    IAS_WHTRNS_MST: ['TR_NO', 'TR_SER', 'W_CODE', 'T_W_CODE', 'F_TR_SER', 'TR_POST', 'STK_PROCESSED', 'POST_DATE'],
    ITEM_MOVEMENT: ['DOC_SER', 'DOC_TYPE', 'I_CODE', 'W_CODE'],
  };
  const tables = Object.keys(required);
  const tableBinds = Object.fromEntries(tables.map((table, index) => [`table${index}`, table]));
  return {
    sql: `SELECT TABLE_NAME, COLUMN_NAME FROM ALL_TAB_COLUMNS
WHERE OWNER = :owner AND TABLE_NAME IN (${tables.map((_, index) => `:table${index}`).join(', ')})`,
    binds: { owner: schema, ...tableBinds },
    required,
  };
}

module.exports = { compatibility, stock, transferEvidence, warehouseExists };
