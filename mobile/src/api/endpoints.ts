import { getClient } from './client';

export interface SyncResponse {
  syncToken: string;
  serverTime: string;
  snapshot: 'full';
  schemaVersion: number;
  tasks: any[];
  customers: any[];
  followups: any[];
  promises: any[];
  collections: any[];
  reservations: any[];
  newDebt: any | null;
  references: {
    currencies: Currency[];
    collectionMethods: NamedOption[];
    followupTypes: NamedOption[];
    followupResults: NamedOption[];
    reservationUnits: ReservationUnit[];
  };
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

export interface ReservationUnit {
  id: string;
  code: string;
  nameAr: string;
  weightKg: number | null;
}

export async function fetchSync(lastSyncToken?: string) {
  const client = await getClient();
  return client.post<SyncResponse>('/mobile/sync', { lastSyncToken });
}

export async function uploadGps(points: GpsPoint[]) {
  const client = await getClient();
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

export async function uploadReceipt(fileUri: string, collectionId: string, notes?: string) {
  const client = await getClient();
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

export async function fetchTodayBoard() {
  const client = await getClient();
  return client.get('/tasks/today');
}

export async function completeTask(id: string) {
  const client = await getClient();
  return client.patch(`/tasks/${id}/complete`);
}

export async function fetchCustomers(query?: string) {
  const client = await getClient();
  return client.get('/mobile/customers', { params: { q: query } });
}

export async function fetchCustomer360(id: string) {
  const client = await getClient();
  return client.get(`/mobile/customers/${id}`);
}

export async function fetchInventorySummary() {
  const client = await getClient();
  return client.get('/mobile/inventory/summary');
}

export async function fetchInventoryItems(search = '', page = 1) {
  const client = await getClient();
  return client.get('/mobile/inventory/items', { params: { search: search || undefined, page, limit: 30 } });
}

export async function fetchInventoryItem(code: string) {
  const client = await getClient();
  return client.get(`/mobile/inventory/items/${encodeURIComponent(code)}`);
}

export interface InventoryCountDraftLine {
  itemCode: string;
  unitCode: string;
  countedQuantity: number;
  batchNo?: string;
  expireDate?: string;
}

export interface InventoryCountDraftPayload {
  inventoryType: 1 | 2;
  warehouseCode: string;
  description: string;
  externalReference: string;
  lines: InventoryCountDraftLine[];
}

export async function dryRunInventoryCount(data: InventoryCountDraftPayload) {
  const client = await getClient();
  return client.post('/oracle-test-requests/inventory-counts/dry-run', data);
}

export async function createInventoryCount(data: InventoryCountDraftPayload) {
  const client = await getClient();
  return client.post('/oracle-test-requests/inventory-counts', data);
}

export async function fetchCollectionMethods() {
  const client = await getClient();
  return client.get<NamedOption[]>('/collections/methods');
}

export async function fetchFollowupTypes() {
  const client = await getClient();
  return client.get<NamedOption[]>('/followups/types');
}

export async function fetchFollowupResults() {
  const client = await getClient();
  return client.get<NamedOption[]>('/followups/results');
}

export async function createFollowup(data: {
  customerId: string;
  typeId: string;
  resultId: string;
  notes?: string;
  followupAt?: string;
  nextFollowupDate?: string;
}) {
  const client = await getClient();
  return client.post('/followups', data);
}

export async function createPromise(data: {
  customerId: string;
  expectedAmount: number;
  currencyCode: string;
  dueDate: string;
  notes?: string;
  collectorId?: string;
}) {
  const client = await getClient();
  return client.post('/payment-promises', data);
}

export async function createCollection(data: {
  customerId: string;
  amount: number;
  currencyCode: string;
  methodId: string;
  notes?: string;
  collectedAt?: string;
  collectorId?: string;
  referenceNumber?: string;
}) {
  const client = await getClient();
  return client.post('/collections', data);
}

export interface Currency {
  code: string;
  sourceCode: string;
  nameAr: string;
  decimals: number;
  active: boolean;
}

export async function fetchCurrencies() {
  const client = await getClient();
  return client.get<Currency[]>('/currencies');
}

export async function fetchReservationUnits() {
  const client = await getClient();
  return client.get<ReservationUnit[]>('/reservations/units');
}

export async function createReservation(data: {
  customerId: string;
  itemName: string;
  itemType?: string;
  quantity: number;
  unitId: string;
  unitPrice: number;
  currencyCode: string;
  warehouse?: string;
  documentNumber?: string;
  notes?: string;
  expiresAt?: string;
}) {
  const client = await getClient();
  return client.post('/reservations', data);
}

export async function fetchNotifications() {
  const client = await getClient();
  return client.get('/notifications', { params: { page: 1, limit: 25 } });
}

export async function fetchTasks() {
  const client = await getClient();
  return client.get('/tasks');
}

export async function createTask(data: {
  customerId: string;
  taskType: string;
  dueDate: string;
  assignedTo?: string;
  priorityReason?: string;
  expectedAmount?: number;
  expectedCurrency?: string;
}) {
  const client = await getClient();
  return client.post('/tasks', data);
}

export async function requestAssignmentChange(data: {
  customerId: string;
  reason: string;
  requestedCollectorId?: string;
}) {
  const client = await getClient();
  return client.post('/assignments/change-requests', data);
}

export async function markNotificationRead(id: string) {
  const client = await getClient();
  return client.patch(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead() {
  const client = await getClient();
  return client.patch('/notifications/read-all');
}
