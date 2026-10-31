import {inventoryCostAccess} from '../utils/inventory-cost-access';
import { isOperationsApp } from '../config/product';
import {getCachedUser} from '../utils/secure-storage';
import { getClient } from './client';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import {
  getInventoryItemOffline,
  getInventorySummaryOffline,
  getReferenceOptions,
  hasInventoryCatalogOffline,
  mergeReferenceOptions,
  replaceReferenceOptions,
  searchInventoryItemsOffline,
  replaceCustomerOrdersSnapshot,
} from '../db/database';
import { matchesSmartSearch } from '../utils/search';

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
  customerAlerts?: { unassigned: number; newCustomers: number; since: string } | null;
  references: {
    currencies: Currency[];
    collectionMethods: NamedOption[];
    followupTypes: NamedOption[];
    followupResults: NamedOption[];
    reservationUnits: ReservationUnit[];
    oracleCurrencies?: any[];
    oracleReceiptCatalog?: any[];
    oraclePaymentCatalog?: any[];
    oracleWarehouses?: any[];
    oracleItems?: any[];
    oracleInventorySummary?: any[];
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
  const startedAt = Date.now();
  // The first offline snapshot includes the complete Oracle item/unit catalog.
  // It is intentionally larger than ordinary API calls and can exceed the
  // client's 15-second default while still progressing normally on the LAN.
  const response = await client.post<SyncResponse>(
    isOperationsApp ? '/mobile/operations-sync' : '/mobile/collection-sync',
    { lastSyncToken },
    { timeout: 90_000 },
  );
  const key = 'albinaa.device-id';
  let deviceId = await SecureStore.getItemAsync(key);
  if (!deviceId) {
    deviceId = `device-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    await SecureStore.setItemAsync(key, deviceId);
  }
  await client.post('/mobile/heartbeat', {
    deviceId,
    deviceName: (Constants as any).deviceName || `${Platform.OS} device`,
    platform: Platform.OS,
    appVersion: Constants.expoConfig?.version || '1.3.18',
    lastSyncedAt: new Date().toISOString(),
    responseMs: Date.now() - startedAt,
  }).catch(() => undefined);
  return response;
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
    timeout: 60_000,
  });
}

export async function uploadOracleRequestReceipt(
  fileUri: string,
  kind: 'receipt' | 'payment',
  requestNo: string,
  externalReference?: string,
) {
  const client = await getClient();
  const form = new FormData();
  const filename = fileUri.split('/').pop() || `${kind}-${requestNo}.jpg`;
  form.append('file', { uri: fileUri, name: filename, type: resolveUploadMime(fileUri, filename) } as any);
  form.append('kind', kind);
  form.append('requestNo', requestNo);
  if (externalReference) form.append('externalReference', externalReference);
  return client.post('/mobile/upload-request-receipt', form, {
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
  const cached = await getInventorySummaryOffline();
  if (cached) return { data: inventoryCostAccess(cached,(await getCachedUser())?.permissions??[]), offline: true } as any;
  const client = await getClient();
  const response = await client.get('/mobile/inventory/summary');
  await replaceReferenceOptions('oracleInventorySummary', [{ id: 'current', name: 'ملخص المخزون', ...response.data }]);
  return response;
}

export async function fetchInventoryItems(search = '', page = 1) {
  if (await hasInventoryCatalogOffline()) {
    const limit = 30;
    const items = await searchInventoryItemsOffline(search, limit, (Math.max(1, page) - 1) * limit);
    return { data: { items:inventoryCostAccess(items,(await getCachedUser())?.permissions??[]), page, limit }, offline: true } as any;
  }
  const client = await getClient();
  return client.get('/mobile/inventory/items', { params: { search: search || undefined, page, limit: 30 } });
}

export async function fetchInventoryItem(code: string) {
  const cached = await getInventoryItemOffline(code);
  if (cached) return { data: inventoryCostAccess(cached,(await getCachedUser())?.permissions??[]), offline: true } as any;
  const client = await getClient();
  return client.get(`/mobile/inventory/items/${encodeURIComponent(code)}`);
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
  totalTons: number;
  unitPrice: number;
  currencyCode: 'YER' | 'SAR';
  documentNumber?: string;
  notes?: string;
  expiresAt?: string;
}, operationId?: string) {
  const client = await getClient();
  return client.post('/reservations', data, { headers: operationId ? { 'Idempotency-Key': operationId } : undefined });
}

export type OracleRequestKind = 'purchase' | 'receipt' | 'payment' | 'journal' | 'inventory_transfer' | 'inventory_count';

export async function fetchOracleRequestCatalog(purpose: 'receipt' | 'payment') {
  const client = await getClient();
  const kind = purpose === 'receipt' ? 'oracleReceiptCatalog' : 'oraclePaymentCatalog';
  try {
    const response = await client.get('/oracle-test-requests/catalog', { params: { purpose } });
    await replaceReferenceOptions(kind, [{ id: purpose, name: purpose, ...response.data }]);
    return response;
  } catch (error) {
    const cached = await getReferenceOptions(kind);
    if (cached[0]) return { data: cached[0], offline: true } as any;
    throw error;
  }
}

export async function fetchOracleRequestCurrencies() {
  const client = await getClient();
  try {
    const response = await client.get('/oracle-test-requests/currencies');
    await replaceReferenceOptions('oracleCurrencies', response.data?.currencies || []);
    return response;
  } catch (error) {
    const cached = await getReferenceOptions('oracleCurrencies');
    if (cached.length) return { data: { currencies: cached }, offline: true } as any;
    throw error;
  }
}

export async function fetchCreatedOracleRequests() {
  const client = await getClient();
  return client.get('/oracle-test-requests/created');
}

export async function fetchCustomerOrdersOfflineSnapshot() {
  const client = await getClient();
  const response = await client.get('/sales-order-drafts/offline');
  await replaceCustomerOrdersSnapshot(response.data?.items || []);
  return response;
}

export async function dryRunCustomerOrder(payload: unknown) {
  const client = await getClient();
  return client.post('/sales-order-drafts/dry-run', payload);
}

export async function dryRunOracleRequest(kind: 'purchase' | 'voucher' | 'journal', payload: unknown) {
  const client = await getClient();
  const route = kind === 'purchase' ? 'purchases' : kind === 'voucher' ? 'vouchers' : 'journals';
  return client.post(`/oracle-test-requests/${route}/dry-run`, payload);
}

export async function createOracleRequest(kind: 'purchase' | 'voucher' | 'journal', payload: unknown) {
  const client = await getClient();
  const route = kind === 'purchase' ? 'purchases' : kind === 'voucher' ? 'vouchers' : 'journals';
  return client.post(`/oracle-test-requests/${route}`, payload);
}

export interface InventoryCountDraftPayload {
  inventoryType: number;
  warehouseCode: string;
  description: string;
  externalReference: string;
  lines: Array<{ itemCode: string; unitCode: string; countedQuantity: number }>;
}

export async function dryRunInventoryCount(payload: InventoryCountDraftPayload) {
  const client = await getClient();
  return client.post('/oracle-test-requests/inventory-counts/dry-run', payload);
}

export async function createInventoryCount(payload: InventoryCountDraftPayload) {
  const client = await getClient();
  return client.post('/oracle-test-requests/inventory-counts', payload);
}

export async function fetchTransferWarehouses() {
  const cached = await getReferenceOptions('oracleWarehouses');
  if (cached.length) return { data: { items: cached }, offline: true } as any;
  const client = await getClient();
  const response = await client.get('/inventory-transfers/lookups/warehouses');
  await replaceReferenceOptions('oracleWarehouses', response.data?.items ?? response.data ?? []);
  return response;
}

export async function searchTransferItems(search = '') {
  if (await hasInventoryCatalogOffline()) {
    const items = await searchInventoryItemsOffline(search, 40);
    return { data: { items }, offline: true } as any;
  }
  const client = await getClient();
  try {
    const response = await client.get('/inventory-transfers/lookups/items', { params: { search, page: 1, limit: 40 } });
    await mergeReferenceOptions('oracleItems', response.data?.items ?? response.data ?? []);
    return response;
  } catch (error) {
    const cached = await getReferenceOptions('oracleItems');
    const needle = search.trim();
    const filtered = !needle ? cached : cached.filter((item) => matchesSmartSearch(
      [item.externalItemCode, item.itemCode, item.nameAr, item.itemName, item.sizeName, item.size].join(' '),
      needle,
    ));
    if (filtered.length) return { data: { items: filtered.slice(0, 40) }, offline: true } as any;
    throw error;
  }
}

export async function fetchTransferItem(itemCode: string) {
  const local = await getInventoryItemOffline(itemCode);
  if (local) return { data: local, offline: true } as any;
  const client = await getClient();
  try {
    const response = await client.get(`/inventory-transfers/lookups/items/${encodeURIComponent(itemCode)}`);
    await mergeReferenceOptions('oracleItems', [{ ...response.data, externalItemCode: response.data?.externalItemCode ?? itemCode }]);
    return response;
  } catch (error) {
    const cached = await getReferenceOptions('oracleItems');
    const item = cached.find((row) => String(row.externalItemCode ?? row.itemCode) === String(itemCode));
    if (item) return { data: item, offline: true } as any;
    throw error;
  }
}

export async function createInventoryTransfer(payload: unknown, idempotencyKey: string) {
  const client = await getClient();
  return client.post('/inventory-transfers', payload, { headers: { 'Idempotency-Key': idempotencyKey } });
}

export async function dryRunInventoryTransfer(id: string) {
  const client = await getClient();
  return client.post(`/inventory-transfers/${id}/dry-run`);
}

export async function submitInventoryTransfer(id: string, idempotencyKey: string) {
  const client = await getClient();
  return client.post(`/inventory-transfers/${id}/submit`, undefined, { headers: { 'Idempotency-Key': idempotencyKey } });
}

export async function fetchNotifications() {
  const client = await getClient();
  return client.get('/notifications', { params: { page: 1, limit: 25, application: isOperationsApp ? 'operations' : 'collector' } });
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
  return client.patch(`/notifications/read-all?application=${isOperationsApp ? 'operations' : 'collector'}`);
}
