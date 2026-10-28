type Numeric = number | string | { toString(): string };
export function mobileReservationValue(r: {
  status?: string | null;
  quantity?: Numeric | null; remainingQty?: Numeric | null;
  totalTons?: Numeric | null; remainingTons?: Numeric | null;
  totalAmount?: Numeric | null; creditAmount?: Numeric | null;
  unitPrice?: Numeric | null; measureUnit?: { weightKg?: Numeric | null } | null;
}) {
  const quantity = Number(r.quantity ?? r.remainingQty ?? 0);
  if (['cancelled', 'completed', 'fulfilled'].includes(r.status ?? '')) {
    return { quantity, remainingQty: 0, totalTons: 0, totalAmount: 0, averageTonPrice: null };
  }
  const remainingQty = Number(r.remainingQty ?? r.quantity ?? 0);
  const originalAmount = Number(r.totalAmount ?? r.creditAmount ?? 0);
  const weightKg = r.measureUnit?.weightKg == null ? null : Number(r.measureUnit.weightKg);
  const totalTons = r.remainingTons != null ? Number(r.remainingTons)
    : weightKg == null ? null : remainingQty * weightKg / 1000;
  // The mobile SQLite contract describes outstanding goods. Stored original
  // contract amounts are preserved; existing app versions also get the fix.
  const priceQuantity = r.totalTons != null && r.remainingTons != null
    ? Number(r.remainingTons) : remainingQty;
  const originalQuantity = Number(r.totalTons ?? r.quantity ?? 0);
  const unitPrice = r.unitPrice != null ? Number(r.unitPrice)
    : originalQuantity > 0 ? originalAmount / originalQuantity : 0;
  const totalAmount = Math.round(priceQuantity * unitPrice * 100) / 100;
  return { quantity, remainingQty, totalTons, totalAmount,
    averageTonPrice: totalTons != null && totalTons > 0 ? totalAmount / totalTons : null };
}
