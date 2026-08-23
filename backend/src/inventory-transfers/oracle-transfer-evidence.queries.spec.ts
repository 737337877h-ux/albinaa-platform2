import { buildOracleTransferEvidenceQueries } from './oracle-transfer-evidence.queries';

describe('Oracle 11g transfer evidence queries', () => {
  it('links ITEM_MOVEMENT through DOC_SER and excludes the source row from destinations', () => {
    const queries = buildOracleTransferEvidenceQueries('IAS20261', ['295602501014']);
    expect(queries.destinationDocuments).toContain('TR_SER <> :sourceTransferSerial');
    expect(queries.movements).toContain('DOC_SER = :sourceTransferSerial');
    expect(queries.movements).toContain('DOC_TYPE IN (7, 8)');
    expect(queries.movements).not.toContain('TR_POST');
  });

  it('rejects an arbitrary schema identifier', () => {
    expect(() => buildOracleTransferEvidenceQueries('IAS20261.ITEM_MOVEMENT --', ['1'])).toThrow('Invalid configured Oracle schema');
  });
});
