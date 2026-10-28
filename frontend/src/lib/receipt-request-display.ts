export function receiptMethod(item: { paymentMethod?: string | null; description?: string | null }) {
  const description = (item.description ?? '').replace(/[أإآ]/g, 'ا').replace(/ً/g, '');
  if (item.paymentMethod === 'cash') return { key: 'cash', label: 'نقدي', inferred: false };
  // Electronic wallets use Oracle's bank-transfer route; retain the visible
  // channel from the standard receipt description and disclose that source.
  if (item.paymentMethod === 'bank_transfer' && /لكم ايداع عبر/.test(description)) return { key: 'wallet', label: 'إيداع عبر محفظة', inferred: true };
  if (item.paymentMethod === 'bank_transfer') return { key: 'bank', label: 'حوالة بنكية', inferred: false };
  if (item.paymentMethod === 'wallet') return { key: 'wallet', label: 'محفظة إلكترونية', inferred: false };
  if (/ايداع نقد|نقدا/.test(description)) return { key: 'cash', label: 'نقدي', inferred: true };
  if (/ايداع عبر/.test(description)) return { key: 'wallet', label: 'إيداع عبر محفظة', inferred: true };
  if (/لكم حوالة|لكم حواله/.test(description)) return { key: 'bank', label: 'حوالة', inferred: true };
  return { key: 'unknown', label: 'غير محددة', inferred: false };
}
