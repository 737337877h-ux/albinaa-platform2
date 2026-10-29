'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ARST003_TABLES,
  ARST003_SEQUENCE_CONTROL_TABLES,
  BILL_DOC_TYPE_MAP,
  approvalRowsQuery,
  candidateMetadataQuery,
  columnDefaultsMetadataQuery,
  constraintMetadataQuery,
  customerRequestKind,
  detailDocumentSequenceEvidence,
  detailRowsQuery,
  differingFields,
  groupMetadata,
  indexMetadataQuery,
  privilegeMetadataQuery,
  recentRowsQuery,
  reservationRowsQueries,
  requiredColumnsMetadataQuery,
  rowsBySerialQuery,
  scalarColumnNames,
  sequenceCandidateMetadataQuery,
  sequenceControlMetadataQuery,
  sequenceControlRowsQuery,
  serialGeneratorEvidenceQueries,
  selectedColumnNames,
  storedSourceReferenceQuery,
  tableRole,
  triggerMetadataQuery,
} = require('../src/arst003-discovery');

const column = (table, position, name, type = 'NUMBER') => ({
  TABLE_NAME: table, COLUMN_ID: position, COLUMN_NAME: name, DATA_TYPE: type, NULLABLE: 'Y',
});

test('discovers explicit ARST003 candidates with a metadata-only SELECT', () => {
  const sql = candidateMetadataQuery();
  assert.match(sql, /^SELECT /);
  assert.match(sql, /ALL_TAB_COLUMNS/);
  assert.match(sql, /SALES_ORDER/);
  assert.match(sql, /ORDER_DETAIL/);
  assert.match(sql, /IAS_V_NY_SALES_ORDER/);
  assert.match(sql, /IAS_V_NY_ORDER_DETAIL/);
  assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL/i);
});

test('builds bounded SELECT-only ARST003 write metadata queries', () => {
  assert.deepEqual(ARST003_TABLES, ['SALES_ORDER', 'ORDER_DETAIL', 'S_APPRVD_MOV']);
  assert.deepEqual(ARST003_SEQUENCE_CONTROL_TABLES, ['S_SEQ_CTL', 'S_SEQ_VALUES']);
  const queries = [
    requiredColumnsMetadataQuery(),
    columnDefaultsMetadataQuery(),
    constraintMetadataQuery(),
    indexMetadataQuery(),
    triggerMetadataQuery(),
    privilegeMetadataQuery(),
    sequenceCandidateMetadataQuery(30),
    sequenceControlMetadataQuery(),
    sequenceControlRowsQuery('IAS20191', 'S_SEQ_CTL', [column('S_SEQ_CTL', 1, 'DOC_TYPE')], 100),
    storedSourceReferenceQuery(200),
  ];
  for (const sql of queries) {
    assert.match(sql, /^SELECT /);
    assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|MERGE\s+INTO|EXECUTE\s+|NEXTVAL|CURRVAL)\b/i);
  }
  assert.match(requiredColumnsMetadataQuery(), /NULLABLE = 'N'/);
  assert.match(sequenceCandidateMetadataQuery(30), /ROWNUM <= 30/);
  assert.match(columnDefaultsMetadataQuery(), /DATA_DEFAULT/);
  assert.match(sequenceControlRowsQuery('IAS20191', 'S_SEQ_VALUES', [column('S_SEQ_VALUES', 1, 'DOC_TYPE')], 25), /ROWNUM <= 25/);
  assert.match(storedSourceReferenceQuery(200), /ALL_SOURCE/);
  assert.match(storedSourceReferenceQuery(200), /SALES_ORDER/);
  assert.match(storedSourceReferenceQuery(200), /ORDER_SER/);
  assert.match(storedSourceReferenceQuery(200), /ROWNUM <= 200/);
  assert.throws(() => sequenceCandidateMetadataQuery(101), /limit must be between 1 and 100/);
  assert.throws(() => storedSourceReferenceQuery(501), /limit must be between 1 and 500/);
  assert.throws(() => sequenceControlRowsQuery('IAS20191', 'UNKNOWN_TABLE', [column('UNKNOWN_TABLE', 1, 'DOC_TYPE')]), /Unsupported sequence control table/);
});

test('builds bounded SELECT-only evidence queries for both ARST003 serials', () => {
  const queries = serialGeneratorEvidenceQueries('IAS20191', 50);
  assert.deepEqual(Object.keys(queries), [
    'salesOrderHistory',
    'reservationHistory',
    'sequenceCatalog',
    'serialColumnMetadata',
    'serialTableTriggers',
  ]);
  assert.match(queries.salesOrderHistory.sql, /IAS20191\.SALES_ORDER/);
  assert.match(queries.salesOrderHistory.sql, /ORDER_SER DESC/);
  assert.match(queries.reservationHistory.sql, /IAS20191\.IAS_RESERVE_MST/);
  assert.match(queries.reservationHistory.sql, /DOC_TYPE_REF = 53/);
  assert.match(queries.reservationHistory.sql, /DOC_SER DESC/);
  assert.match(queries.sequenceCatalog.sql, /ALL_SEQUENCES/);
  assert.match(queries.serialColumnMetadata.sql, /DATA_DEFAULT/);
  assert.match(queries.serialTableTriggers.sql, /ALL_TRIGGERS/);
  for (const query of Object.values(queries)) {
    assert.match(query.sql, /^SELECT /);
    assert.doesNotMatch(query.sql, /\b(?:INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|MERGE\s+INTO|EXECUTE\s+|NEXTVAL|CURRVAL)\b/i);
  }
  assert.equal(queries.salesOrderHistory.binds.rowLimit, 50);
  assert.equal(queries.reservationHistory.binds.branchYear, 2019);
  assert.throws(() => serialGeneratorEvidenceQueries('IAS20191', 101), /limit must be between 1 and 100/);
  assert.throws(() => serialGeneratorEvidenceQueries('IAS20191;DROP', 50), /Unsafe schema/);
});

test('builds a bound approval SELECT for only observed ARST003 serials', () => {
  const query = approvalRowsQuery('IAS20191', [
    { ORDER_SER: '2019000001531' },
    { ORDER_SER: '2019000001532' },
  ]);
  assert.match(query.sql, /IAS20191\.S_APPRVD_MOV/);
  assert.match(query.sql, /DOC_SER IN \(:orderSer0, :orderSer1\)/);
  assert.equal(query.binds.orderSer1, '2019000001532');
  assert.doesNotMatch(query.sql, /\b(?:INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|MERGE\s+INTO|EXECUTE\s+|NEXTVAL|CURRVAL)\b/i);
});

test('builds bound SELECT-only reservation queries for observed ARST003 serials', () => {
  const queries = reservationRowsQueries('IAS20191', [
    { ORDER_SER: '2019000001536' },
    { ORDER_SER: '2019000001537' },
  ]);
  assert.match(queries.master.sql, /IAS20191\.IAS_RESERVE_MST/);
  assert.match(queries.detail.sql, /IAS20191\.IAS_RESERVE_DTL/);
  for (const query of Object.values(queries)) {
    assert.match(query.sql, /DOC_TYPE_REF = 53/);
    assert.match(query.sql, /DOC_SER_REF IN \(:orderSer0, :orderSer1\)/);
    assert.equal(query.binds.orderSer1, '2019000001537');
    assert.doesNotMatch(query.sql, /\b(?:INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|MERGE\s+INTO|EXECUTE\s+|NEXTVAL|CURRVAL)\b/i);
  }
  assert.throws(() => reservationRowsQueries('IAS20191', [{}]), /missing ORDER_SER/);
  assert.throws(() => reservationRowsQueries('IAS20191;DROP', [{ ORDER_SER: '1' }]), /Unsafe schema/);
});

test('maps the user-confirmed IAS20191 BILL_DOC_TYPE request codes', () => {
  assert.deepEqual(BILL_DOC_TYPE_MAP, {
    1: 'cash',
    4: 'credit',
    6: 'transfer',
  });
  assert.equal(customerRequestKind(1), 'cash');
  assert.equal(customerRequestKind('4'), 'credit');
  assert.equal(customerRequestKind(6), 'transfer');
  assert.equal(customerRequestKind(99), null);
  assert.equal(customerRequestKind(null), null);
});

test('classifies master and detail tables and retains payment evidence fields', () => {
  const master = [column('SALES_ORDER', 1, 'SO_NO'), column('SALES_ORDER', 2, 'SO_SER')];
  const detail = [...master, column('SALES_ORDER_DETAIL', 3, 'I_CODE', 'VARCHAR2')];
  assert.equal(tableRole('SALES_ORDER', master), 'master');
  assert.equal(tableRole('SALES_ORDER_DETAIL', detail), 'detail');
  const chosen = selectedColumnNames([...master, column('SALES_ORDER', 3, 'PAY_TYPE'), column('SALES_ORDER', 4, 'BANK_NO')]);
  assert.deepEqual(chosen, ['SO_NO', 'SO_SER', 'PAY_TYPE', 'BANK_NO']);
});

test('builds a bounded Oracle 11g recent-row SELECT with safe identifiers', () => {
  const columns = [column('SALES_ORDER', 1, 'SO_NO'), column('SALES_ORDER', 2, 'SO_SER'), column('SALES_ORDER', 3, 'AD_DATE', 'DATE')];
  const sql = recentRowsQuery('IAS20191', 'SALES_ORDER', columns, 20);
  assert.match(sql, /^SELECT \* FROM \(/);
  assert.match(sql, /IAS20191\.SALES_ORDER/);
  assert.match(sql, /ROWNUM <= :rowLimit/);
  assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL/i);
  assert.throws(() => recentRowsQuery('IAS20191', 'SALES_ORDER;DROP', columns), /Unsafe table name/);
});

test('builds a bound detail SELECT for only the proven ARST003 master keys', () => {
  const columns = [
    column('ORDER_DETAIL', 1, 'SO_TYPE'),
    column('ORDER_DETAIL', 2, 'ORDER_NO'),
    column('ORDER_DETAIL', 3, 'ORDER_SER'),
    column('ORDER_DETAIL', 4, 'I_CODE', 'VARCHAR2'),
    column('ORDER_DETAIL', 5, 'BRN_NO'),
    column('ORDER_DETAIL', 6, 'DOC_SEQ'),
  ];
  const query = detailRowsQuery('IAS20191', 'ORDER_DETAIL', columns, [
    { SO_TYPE: '1', ORDER_NO: '1', ORDER_SER: '2019000001531', BRN_NO: '1' },
  ]);
  assert.match(query.sql, /IAS20191\.ORDER_DETAIL/);
  assert.match(query.sql, /SO_TYPE = :soType0/);
  assert.match(query.sql, /ORDER_SER = :orderSer0/);
  assert.equal(query.binds.orderNo0, '1');
  assert.equal(query.binds.orderSer0, '2019000001531');
  assert.match(query.sql, /DOC_SEQ/);
  assert.doesNotMatch(query.sql, /INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL/i);
});

test('proves IAS_DOC_SEQ_OTHR only against consecutive ORDER_DETAIL DOC_SEQ evidence', () => {
  const evidence = detailDocumentSequenceEvidence([
    { ORDER_SER: '2019000001534', RCRD_NO: '1', DOC_SEQ: '56' },
    { ORDER_SER: '2019000001535', RCRD_NO: '1', DOC_SEQ: '57' },
    { ORDER_SER: '2019000001535', RCRD_NO: '2', DOC_SEQ: '58' },
    { ORDER_SER: '2019000001536', RCRD_NO: '1', DOC_SEQ: '59' },
    { ORDER_SER: '2019000001536', RCRD_NO: '2', DOC_SEQ: '60' },
  ], [
    { SEQUENCE_NAME: 'IAS_DOC_SEQ_OTHR', INCREMENT_BY: '1', LAST_NUMBER: '61' },
  ]);
  assert.deepEqual(evidence.observedDocSequences, [56, 57, 58, 59, 60]);
  assert.equal(evidence.maximumObserved, 60);
  assert.equal(evidence.lastNumber, 61);
  assert.equal(evidence.mappingProven, true);

  assert.equal(detailDocumentSequenceEvidence(
    [{ DOC_SEQ: '56' }, { DOC_SEQ: '58' }],
    [{ SEQUENCE_NAME: 'IAS_DOC_SEQ_OTHR', INCREMENT_BY: '1', LAST_NUMBER: '59' }],
  ).mappingProven, false);
});

test('builds a bound full scalar-row SELECT for before-and-after evidence', () => {
  const columns = [
    column('SALES_ORDER', 1, 'ORDER_SER'),
    column('SALES_ORDER', 2, 'ORDER_NO'),
    column('SALES_ORDER', 3, 'ORDER_DATE', 'DATE'),
    column('SALES_ORDER', 4, 'ORDER_DESC', 'CLOB'),
  ];
  assert.deepEqual(scalarColumnNames(columns), ['ORDER_SER', 'ORDER_NO', 'ORDER_DATE']);
  const query = rowsBySerialQuery(
    'IAS20191',
    'SALES_ORDER',
    columns,
    'ORDER_SER',
    ['2019000001534'],
    ['ORDER_SER', 'ORDER_NO'],
  );
  assert.match(query.sql, /^SELECT ORDER_SER, ORDER_NO, ORDER_DATE/);
  assert.match(query.sql, /IAS20191\.SALES_ORDER/);
  assert.match(query.sql, /ORDER_SER IN \(:serial0\)/);
  assert.match(query.sql, /ORDER BY ORDER_SER, ORDER_NO/);
  assert.equal(query.binds.serial0, '2019000001534');
  assert.doesNotMatch(query.sql, /INSERT|UPDATE|DELETE|MERGE|EXECUTE|NEXTVAL/i);
});

test('groups metadata and reports fields that differ across the three request types', () => {
  const rows = [column('SALES_ORDER', 1, 'SO_NO'), column('SALES_ORDER', 2, 'SO_SER')];
  assert.equal(groupMetadata(rows).get('SALES_ORDER').length, 2);
  assert.deepEqual(differingFields([
    { SO_NO: 1, PAY_TYPE: 1, A_CY: 'R s' },
    { SO_NO: 2, PAY_TYPE: 2, A_CY: 'R s' },
    { SO_NO: 3, PAY_TYPE: 3, A_CY: 'R s' },
  ]), ['SO_NO', 'PAY_TYPE']);
});
