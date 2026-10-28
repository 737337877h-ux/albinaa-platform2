import { enqueueMutation, recordOfflineRequest, resubmitMutation } from '../db/database';

export type OfflineRequestKind =
  | 'purchase'
  | 'receipt'
  | 'payment'
  | 'journal'
  | 'inventory_count'
  | 'inventory_transfer'
  | 'customer_order'
  | 'quotation';

export function newOfflineOperationId(kind: OfflineRequestKind): string {
  return `${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

export async function queueOfflineRequest(options: {
  kind: OfflineRequestKind;
  title: string;
  endpoint: string;
  payload: unknown;
  operationId?: string;
}): Promise<string> {
  const operationId = options.operationId || newOfflineOperationId(options.kind);
  await enqueueMutation(operationId, 'POST', options.endpoint, options.payload);
  await recordOfflineRequest(operationId, options.kind, options.title, options.endpoint, options.payload, 'pending');
  return operationId;
}

export async function saveOfflineDraft(options: {
  kind: OfflineRequestKind;
  title: string;
  endpoint: string;
  payload: unknown;
  operationId?: string;
}): Promise<string> {
  const operationId = options.operationId || newOfflineOperationId(options.kind);
  await recordOfflineRequest(operationId, options.kind, options.title, options.endpoint, options.payload, 'draft');
  return operationId;
}

export async function submitOfflineDraft(options: {
  kind: OfflineRequestKind;
  title: string;
  endpoint: string;
  payload: unknown;
  operationId: string;
}): Promise<string> {
  await recordOfflineRequest(options.operationId, options.kind, options.title, options.endpoint, options.payload, 'pending');
  await resubmitMutation(options.operationId, 'POST', options.endpoint, options.payload);
  return options.operationId;
}

export function isConnectionError(error: any): boolean {
  return !error?.response || error?.code === 'ECONNABORTED' || error?.message === 'Network Error';
}
