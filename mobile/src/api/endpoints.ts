import client from './client';

export interface SyncResponse {
  syncToken: string;
  serverTime: string;
  tasks: any[];
  customers: any[];
  followups: any[];
  promises: any[];
  collections: any[];
}

export interface GpsPoint {
  latitude: number;
  longitude: number;
  accuracy?: number;
  entityTable?: string;
  entityId?: string;
  recordedAt: string;
}

export interface NamedOption {
  id: string;
  name: string;
}

export function fetchSync(lastSyncToken?: string) {
  return client.post<SyncResponse>('/mobile/sync', { lastSyncToken });
}

export function uploadGps(points: GpsPoint[]) {
  if (points.length === 1) {
    return client.post('/mobile/gps', points[0]);
  }
  return client.post('/mobile/gps/batch', points);
}

function resolveUploadMime(fileUri: string, filename: string): string {
  const lower = `${filename} ${fileUri}`.toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.gif')) return 'image/gif';
  if (lower.includes('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}

export function uploadReceipt(fileUri: string, collectionId: string, notes?: string) {
  const form = new FormData();
  const filename = fileUri.split('/').pop() || `receipt-${Date.now()}.jpg`;
  const mime = resolveUploadMime(fileUri, filename);
  const safeName = filename.includes('.') ? filename : `${filename}.jpg`;
  form.append('file', { uri: fileUri, name: safeName, type: mime } as any);
  form.append('collectionId', collectionId);
  if (notes) form.append('notes', notes);
  return client.post('/mobile/upload-receipt', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
  });
}

export function fetchTasks() {
  return client.get('/tasks/today');
}

export function completeTask(id: string) {
  return client.patch(`/tasks/${id}/complete`);
}

export function fetchCustomers(query?: string) {
  return client.get('/mobile/customers', { params: { q: query } });
}

export function fetchCustomer360(id: string) {
  return client.get(`/mobile/customers/${id}`);
}

export function fetchCollectionMethods() {
  return client.get<NamedOption[]>('/collections/methods');
}

export function fetchFollowupTypes() {
  return client.get<NamedOption[]>('/followups/types');
}

export function fetchFollowupResults() {
  return client.get<NamedOption[]>('/followups/results');
}

export function createFollowup(data: {
  customerId: string;
  typeId: string;
  resultId: string;
  notes?: string;
  followupAt?: string;
  nextFollowupDate?: string;
}) {
  return client.post('/followups', data);
}

export function createPromise(data: {
  customerId: string;
  expectedAmount: number;
  currencyCode: string;
  dueDate: string;
  notes?: string;
  collectorId?: string;
}) {
  return client.post('/payment-promises', data);
}

export function createCollection(data: {
  customerId: string;
  amount: number;
  currencyCode: string;
  methodId: string;
  notes?: string;
  collectedAt?: string;
  collectorId?: string;
  referenceNumber?: string;
}) {
  return client.post('/collections', data);
}

export function fetchNotifications() {
  return client.get('/notifications');
}

export function markNotificationRead(id: string) {
  return client.patch(`/notifications/${id}/read`);
}

export function markAllNotificationsRead() {
  return client.patch('/notifications/read-all');
}
