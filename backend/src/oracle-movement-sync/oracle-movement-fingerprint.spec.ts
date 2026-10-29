import { fingerprintCustomerMovements } from './oracle-movement-snapshot.service';

it('keeps historical financial fingerprints stable when collector metadata is added or corrected', () => {
  const original = { C_CODE: '30124', A_CY: 'SR', DOC_SER: '202600000000000001', CR_AMT: '100.00' };
  const old = fingerprintCustomerMovements([original, original]);
  const enriched = fingerprintCustomerMovements([{ ...original, COL_NO: '1' }, { ...original, COL_NO: '2' }]);
  expect(enriched.map((row) => row.sourceFingerprint)).toEqual(old.map((row) => row.sourceFingerprint));
  expect(new Set(enriched.map((row) => row.sourceFingerprint)).size).toBe(2);
});
