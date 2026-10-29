export type OracleRequestAuditRow = {
  id: string;
  entityId: string | null;
  createdAt: Date;
  newValue: unknown;
};

export type DurableOracleRequest = {
  auditId: string;
  kind: string;
  requestNo: string | null;
  requestSerial: string;
  status: 'pending_approval';
  createdAt: Date;
  amount: number | null;
  currencyCode: string | null;
  platformCustomerId: string | null;
  platformCustomerCode: string | null;
  recipientName: string | null;
  collectorNo: number | null;
  externalReference: string | null;
  paymentMethod: string | null;
  cashOrBankNo: string | null;
  description: string | null;
  referenceNo: string | null;
};

function text(value: unknown): string | null {
  const result = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim() : '';
  return result || null;
}

export function platformCurrencyCode(value: unknown): string {
  const code = text(value)?.toUpperCase() ?? '';
  if (['YR', 'YER'].includes(code)) return 'YER';
  if (['SR', 'SAR'].includes(code)) return 'SAR';
  if (['US$', 'USD'].includes(code)) return 'USD';
  return code;
}

/**
 * Oracle is authoritative for the current request status, while the durable
 * platform audit contains creation-time fields that the status query does not
 * return (amount, currency and recipient). Preserve every meaningful live
 * value and only fill its gaps from the durable record.
 */
export function mergeOracleRequestRecords(
  live: Record<string, unknown>,
  durable: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...durable };
  for (const [key, value] of Object.entries(live)) {
    if (value !== null && value !== undefined && value !== '') result[key] = value;
  }
  return result;
}

/**
 * يحوّل أثر إنشاء طلب Oracle إلى سجل تقريري دائم. بوابة القراءة قد تتوقف أو
 * تفقد ذاكرتها بعد إعادة التشغيل، بينما AuditLog في قاعدة المنصة هو المرجع
 * الدائم لما أُنشئ من التطبيق والمنصة.
 */
export function durableOracleRequest(row: OracleRequestAuditRow): DurableOracleRequest | null {
  if (!row.newValue || typeof row.newValue !== 'object' || Array.isArray(row.newValue)) return null;
  const value = row.newValue as Record<string, unknown>;
  const rawKind = text(value.kind);
  const kind = rawKind === 'voucher' ? text(value.requestKind) : rawKind;
  if (!kind) return null;
  const requestSerial = text(value.requestSerial) ?? text(value.documentSerial) ?? text(row.entityId);
  if (!requestSerial) return null;
  const parsedAmount = Number(value.amount);
  const parsedCollectorNo = Number(value.collectorNo);
  return {
    auditId: row.id,
    kind,
    requestNo: text(value.requestNo) ?? text(value.documentNo),
    requestSerial,
    status: 'pending_approval',
    createdAt: row.createdAt,
    amount: Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null,
    currencyCode: platformCurrencyCode(value.currencyCode) || null,
    platformCustomerId: text(value.platformCustomerId),
    platformCustomerCode: text(value.platformCustomerCode),
    recipientName: text(value.recipientName),
    collectorNo: Number.isSafeInteger(parsedCollectorNo) && parsedCollectorNo > 0 ? parsedCollectorNo : null,
    externalReference: text(value.externalReference),
    paymentMethod: ['cash', 'bank_transfer', 'wallet'].includes(String(value.paymentMethod)) ? String(value.paymentMethod) : null,
    cashOrBankNo: text(value.cashOrBankNo),
    description: text(value.description),
    referenceNo: text(value.referenceNo),
  };
}
