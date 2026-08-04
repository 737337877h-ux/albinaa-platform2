export function safePercent(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

export function calculateDso(closingReceivables: number, creditSales: number, daysInMonth: number) {
  return creditSales > 0 ? (Math.max(0, closingReceivables) / creditSales) * daysInMonth : null;
}

export function calculateCei(opening: number, sales: number, closing: number, currentReceivables: number | null) {
  if (currentReceivables === null) return null;
  const denominator = opening + sales - currentReceivables;
  return denominator > 0 ? ((opening + sales - closing) / denominator) * 100 : null;
}

export function weightedDebtAge(buckets: { bucket_0_30: number; bucket_31_60: number; bucket_61_90: number; bucket_91_120: number; bucket_120_plus: number }) {
  const pairs = [[buckets.bucket_0_30, 15], [buckets.bucket_31_60, 45], [buckets.bucket_61_90, 75], [buckets.bucket_91_120, 105], [buckets.bucket_120_plus, 150]];
  const total = pairs.reduce((sum, [amount]) => sum + amount, 0);
  return total > 0 ? pairs.reduce((sum, [amount, days]) => sum + amount * days, 0) / total : null;
}
