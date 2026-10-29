import { durableOracleRequest, OracleRequestAuditRow } from './oracle-request-audit';

export function resolveReceiptAudit<T extends OracleRequestAuditRow>(item: Record<string, unknown>, rows: T[]) {
  const kind = String(item.kind ?? '');
  const serial = String(item.requestSerial ?? '').trim();
  const number = String(item.requestNo ?? '').trim();
  const reference = String(item.externalReference ?? '').trim();
  const matches = rows.filter(row => {
    const request = durableOracleRequest(row);
    return request && request.kind === kind
      && (serial ? request.requestSerial === serial : request.requestNo === number)
      && (!reference || request.externalReference === reference);
  });
  // A reused serial/number is not a unique request identity. Never guess.
  return matches.length === 1 ? matches[0] : null;
}

export function latestReceiptByAudit<T extends { entityId: string; uploadedAt: Date }>(rows: T[]) {
  const map = new Map<string, T>();
  for (const row of rows) {
    const previous = map.get(row.entityId);
    if (!previous || row.uploadedAt > previous.uploadedAt) map.set(row.entityId, row);
  }
  return map;
}
