const SCHEMA_NAME = /^[A-Z][A-Z0-9_$#]{0,29}$/;

export interface OracleEvidenceQueries {
  sourceDocument: string;
  destinationDocuments: string;
  movements: string;
  movementBinds: Record<string, string>;
}

/**
 * SELECT-only Oracle 11g query set for the separate Oracle Read API.
 * The schema is an administrator configuration value, never request input.
 */
export function buildOracleTransferEvidenceQueries(schema: string, itemCodes: string[]): OracleEvidenceQueries {
  const normalizedSchema = schema.trim().toUpperCase();
  if (!SCHEMA_NAME.test(normalizedSchema)) throw new Error('Invalid configured Oracle schema');
  const uniqueItems = [...new Set(itemCodes.map((code) => code.trim()).filter(Boolean))];
  if (uniqueItems.length === 0) throw new Error('At least one item code is required');
  const movementBinds = Object.fromEntries(uniqueItems.map((code, index) => [`item${index}`, code]));
  const itemPlaceholders = uniqueItems.map((_, index) => `:item${index}`).join(', ');

  return {
    sourceDocument: `SELECT TO_CHAR(TR_SER, 'FM99999999999999999999') AS TRANSFER_SERIAL,
       TO_CHAR(TR_NO, 'FM99999999999999999999') AS TRANSFER_DOCUMENT_NUMBER,
       TO_CHAR(W_CODE) AS WAREHOUSE_CODE, TO_CHAR(T_W_CODE) AS DESTINATION_WAREHOUSE_CODE,
       TR_POST, STK_PROCESSED, TO_CHAR(POST_DATE, 'YYYY-MM-DD HH24:MI:SS') AS POST_DATE
FROM ${normalizedSchema}.IAS_WHTRNS_MST
WHERE TR_SER = :sourceTransferSerial`,
    destinationDocuments: `SELECT TO_CHAR(TR_SER, 'FM99999999999999999999') AS TRANSFER_SERIAL,
       TO_CHAR(F_TR_SER, 'FM99999999999999999999') AS SOURCE_TRANSFER_SERIAL,
       TO_CHAR(W_CODE) AS WAREHOUSE_CODE
FROM ${normalizedSchema}.IAS_WHTRNS_MST
WHERE F_TR_SER = :sourceTransferSerial
  AND TR_SER <> :sourceTransferSerial`,
    movements: `SELECT TO_CHAR(DOC_SER, 'FM99999999999999999999') AS DOCUMENT_SERIAL,
       DOC_TYPE AS DOCUMENT_TYPE, I_CODE AS ITEM_CODE, TO_CHAR(W_CODE) AS WAREHOUSE_CODE
FROM ${normalizedSchema}.ITEM_MOVEMENT
WHERE I_CODE IN (${itemPlaceholders})
  AND (DOC_SER = :sourceTransferSerial OR DOC_SER IN (
    SELECT TR_SER FROM ${normalizedSchema}.IAS_WHTRNS_MST
    WHERE F_TR_SER = :sourceTransferSerial AND TR_SER <> :sourceTransferSerial
  ))
  AND DOC_TYPE IN (7, 8)`,
    movementBinds,
  };
}
