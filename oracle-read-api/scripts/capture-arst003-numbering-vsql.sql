SET LINESIZE 320
SET PAGESIZE 500
SET LONG 20000
SET LONGCHUNKSIZE 20000
SET TRIMSPOOL ON
SET VERIFY OFF

COLUMN SQL_ID FORMAT A13
COLUMN MODULE FORMAT A18
COLUMN ACTION FORMAT A18
COLUMN LAST_ACTIVE FORMAT A19
COLUMN SQL_TEXT FORMAT A250

PROMPT ================================================================
PROMPT ARST003 numbering evidence - SELECT only
PROMPT Run from a DBA-authorized SQL*Plus session after using ARST003.
PROMPT This script does not invoke packages, procedures, or sequences.
PROMPT ================================================================

PROMPT Candidate SELECT statements executed by the ARS module:

SELECT *
FROM (
    SELECT
        SQL_ID,
        CHILD_NUMBER,
        MODULE,
        ACTION,
        TO_CHAR(LAST_ACTIVE_TIME, 'YYYY-MM-DD HH24:MI:SS') AS LAST_ACTIVE,
        EXECUTIONS,
        SUBSTR(SQL_TEXT, 1, 250) AS SQL_TEXT
    FROM V$SQL
    WHERE PARSING_SCHEMA_NAME = 'IAS20191'
      AND COMMAND_TYPE = 3
      AND LAST_ACTIVE_TIME >= SYSDATE - (12/24)
      AND UPPER(NVL(MODULE, 'ARS')) LIKE 'ARS%'
    ORDER BY LAST_ACTIVE_TIME DESC
)
WHERE ROWNUM <= 200;

PROMPT Full text for SELECT statements that reference numbering evidence:

SELECT T.SQL_ID, T.PIECE, T.SQL_TEXT
FROM V$SQLTEXT_WITH_NEWLINES T
WHERE T.SQL_ID IN (
    SELECT SQL_ID
    FROM (
        SELECT DISTINCT SQL_ID, LAST_ACTIVE_TIME
        FROM V$SQL
        WHERE PARSING_SCHEMA_NAME = 'IAS20191'
          AND COMMAND_TYPE = 3
          AND LAST_ACTIVE_TIME >= SYSDATE - (12/24)
          AND UPPER(NVL(MODULE, 'ARS')) LIKE 'ARS%'
          AND (
              UPPER(SQL_TEXT) LIKE '%SALES_ORDER%'
              OR UPPER(SQL_TEXT) LIKE '%IAS_RESERVE_MST%'
              OR UPPER(SQL_TEXT) LIKE '%ORDER_SER%'
              OR UPPER(SQL_TEXT) LIKE '%DOC_SER%'
              OR UPPER(SQL_TEXT) LIKE '%ORDER_NO%'
              OR UPPER(SQL_TEXT) LIKE '%S_SEQ_%'
          )
        ORDER BY LAST_ACTIVE_TIME DESC
    )
    WHERE ROWNUM <= 50
)
ORDER BY T.SQL_ID, T.PIECE;

PROMPT End of SELECT-only ARST003 numbering evidence.
