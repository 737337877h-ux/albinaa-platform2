export interface PendingContact {
  customerId: string;
  channel: string;
  leftApp: boolean;
}

/** Opening another app is an attempt, never evidence of a successful call/message. */
export function contactReturn(pending: PendingContact | null, next: string, previous: string, customerId: string) {
  if (!pending || pending.customerId !== customerId) return {pending: null, channel: null};
  if (next !== 'active') return {pending: {...pending, leftApp: true}, channel: null};
  if (previous !== 'active' && pending.leftApp) return {pending: null, channel: pending.channel};
  return {pending, channel: null};
}
