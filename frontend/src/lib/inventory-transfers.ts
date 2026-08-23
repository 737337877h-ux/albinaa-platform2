export type TransferStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'cancelled' | 'dry_run_validated';

export const TRANSFER_STATUS_AR: Record<string, string> = {
  draft: 'مسودة',
  pending_approval: 'بانتظار الاعتماد',
  approved: 'معتمد',
  rejected: 'مرفوض',
  cancelled: 'ملغي',
  dry_run_validated: 'تم التحقق',
};

export function transferStatusTone(status: string): 'neutral' | 'pine' | 'hazard' | 'debt' | 'credit' {
  if (status === 'approved' || status === 'dry_run_validated') return 'credit';
  if (status === 'pending_approval') return 'hazard';
  if (status === 'rejected' || status === 'cancelled') return 'debt';
  return 'neutral';
}

export function oracleStateLabel(sourceIssued: boolean, destinationReceived: boolean, transferCompleted: boolean) {
  if (transferCompleted) return 'مكتمل';
  if (sourceIssued && !destinationReceived) return 'صادر ولم يُستلم';
  if (!sourceIssued && destinationReceived) return 'حالة غير متسقة';
  return 'لم يصدر بعد';
}
