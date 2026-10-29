import { resolveReceiptAudit, latestReceiptByAudit } from './oracle-receipt-binding';

describe('receipt request identity', () => {
  const rows = ['10', '11'].flatMap(no => ['first', 'second'].map(creator => ({
    id: `${no}-${creator}`, entityId: `serial-${no}`, createdAt: new Date(),
    newValue: { kind: 'voucher', requestKind: 'receipt', requestNo: no,
      requestSerial: `serial-${no}`, externalReference: `${creator}-${no}` },
  })));
  it.each(['10', '11'])('does not confuse a reused request %s or serial', no => {
    expect(resolveReceiptAudit({ kind: 'receipt', requestNo: no }, rows)).toBeNull();
    expect(resolveReceiptAudit({ kind: 'receipt', requestSerial: `serial-${no}` }, rows)).toBeNull();
    expect(resolveReceiptAudit({ kind: 'receipt', requestNo: no,
      externalReference: `second-${no}` }, rows)?.id).toBe(`${no}-second`);
  });
  it('rejects a mismatched reference, kind or uploader scope', () => {
    expect(resolveReceiptAudit({ kind: 'receipt', requestNo: '10', externalReference: 'second-11' }, rows)).toBeNull();
    expect(resolveReceiptAudit({ kind: 'payment', requestNo: '10', externalReference: 'second-10' }, rows)).toBeNull();
    expect(resolveReceiptAudit({ kind: 'receipt', requestNo: '10', externalReference: 'second-10' }, rows.filter(r => r.id.endsWith('first')))).toBeNull();
  });
  it('chooses the latest image only within the same proven creation identity', () => {
    const newest = { id: 'new', entityId: '10-second', uploadedAt: new Date('2026-09-08') };
    const old = { id: 'old', entityId: '10-second', uploadedAt: new Date('2026-09-06') };
    const other = { id: 'other', entityId: '10-first', uploadedAt: new Date('2026-09-09') };
    expect(latestReceiptByAudit([newest, other, old]).get('10-second')?.id).toBe('new');
    expect(latestReceiptByAudit([old, newest]).get('10-second')?.id).toBe('new');
  });
});
