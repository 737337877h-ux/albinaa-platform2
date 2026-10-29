import {syncAttendance} from './attendance-offline';
import { fetchQuotationsOfflineSnapshot } from '../api/quotations';
import { submitQueuedQuotation } from './quotation-sync';
import { fetchCustomerOrdersOfflineSnapshot, fetchSync, uploadGps } from '../api/endpoints';
import { getClient } from '../api/client';
import {
  applySyncSnapshot, blockMutation, getMeta, getMutationQueueStats,
  getPendingMutations, getUnsyncedGps, hasInventoryCatalogOffline, incrementRetry,
  markGpsSynced, markOfflineRequestResult, removeMutation, saveGpsPoint,
} from '../db/database';
import { rescheduleOfflineReminders } from './local-notifications';
import { resolveCustomerOrderEndpoint, submitQueuedCustomerOrder, submitQueuedOracleCustomerOrder } from './customer-order-sync';

export function retryableSyncStatus(status?: number): boolean {
  return status === undefined || status === 401 || status === 408 || status === 425 || status === 429 || status >= 500;
}

export function syncErrorMessage(error: any): string {
  const serverMessage = error?.response?.data?.message;
  if (Array.isArray(serverMessage)) return serverMessage.join('، ');
  return serverMessage || error?.message || 'تعذر الاتصال بالخادم المحلي';
}

function receiptMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}

function sanitizeLegacyGpsPayload(endpoint: string, payload: any) {
  if (endpoint !== '/collections' && endpoint !== '/payment-promises') return payload;
  const clean = { ...payload };
  delete clean.gpsLatitude;
  delete clean.gpsLongitude;
  delete clean.gpsAccuracy;
  return clean;
}

async function executeQueuedRequest(client: any, mutation: any, rawPayload: any) {
  const {
    __attachmentUri: attachmentUri,
    __attachmentName: attachmentName,
    __offlineWorkflow: offlineWorkflow,
    ...rawBusinessPayload
  } = rawPayload || {};
  const payload = sanitizeLegacyGpsPayload(mutation.endpoint, rawBusinessPayload);
  const headers = { 'Idempotency-Key': mutation.operationId };
  if (offlineWorkflow === 'request-attachment-only') {
    const form = new FormData();
    const name = attachmentName || 'receipt.jpg';
    form.append('file', { uri: attachmentUri, name, type: receiptMime(name) } as any);
    form.append('kind', String(payload.kind));
    form.append('requestNo', String(payload.requestNo));
    if (payload.externalReference) form.append('externalReference', String(payload.externalReference));
    return client.post('/mobile/upload-request-receipt', form, { headers, timeout: 60_000 });
  }
  if (offlineWorkflow === 'inventory-transfer-submit') {
    const created = await client.post('/inventory-transfers', payload, { headers });
    const id = created.data?.id;
    if (!id) throw new Error('لم يُرجع الخادم رقم مسودة التحويل');
    const checked = await client.post(`/inventory-transfers/${id}/dry-run`);
    if (checked.data?.valid !== true) {
      const issue = (checked.data?.issues || []).map((item: any) => item.message).filter(Boolean).join('، ');
      const error: any = new Error(issue || 'لم ينجح فحص التحويل المخزني');
      error.response = { status: 422, data: { message: error.message } };
      throw error;
    }
    return client.post(`/inventory-transfers/${id}/submit`, undefined, {
      headers: { 'Idempotency-Key': `${mutation.operationId}:submit` },
    });
  }
  if (offlineWorkflow === 'quotation-submit' || mutation.endpoint === '/quotations') {
    return submitQueuedQuotation(client, payload);
  }
  if (offlineWorkflow === 'sales-order-submit') {
    return submitQueuedCustomerOrder(client, mutation.operationId, payload);
  }
  if (offlineWorkflow === 'oracle-sales-order-submit') return submitQueuedOracleCustomerOrder(client, mutation.operationId, payload);
  if (String(mutation.endpoint).startsWith('/oracle-test-requests/')) {
    const checked = await client.post(`${mutation.endpoint}/dry-run`, payload, { headers });
    if (checked.data?.valid === false || checked.data?.saveAllowed === false) {
      const issue = (checked.data?.issues || []).map((item: any) => item.message).filter(Boolean).join('، ');
      const error: any = new Error(issue || checked.data?.saveBlockedReason || 'لم يسمح فحص Oracle بحفظ المسودة');
      error.response = { status: 422, data: { message: error.message } };
      throw error;
    }
  }
  const endpoint = await resolveCustomerOrderEndpoint(mutation.endpoint);
  const response = await client({ method: mutation.type.toLowerCase(), url: endpoint, data: payload, headers });
  if (attachmentUri && ['/oracle-test-requests/vouchers'].includes(String(mutation.endpoint))) {
    const requestNo = String(response.data?.requestNo ?? response.data?.requestSerial ?? response.data?.documentNo ?? '');
    if (!requestNo) throw new Error('تم حفظ السند لكن لم يُرجع الخادم رقمه لرفع صورة الإيصال');
    const form = new FormData();
    const name = attachmentName || 'receipt.jpg';
    form.append('file', { uri: attachmentUri, name, type: receiptMime(name) } as any);
    form.append('kind', String(payload.kind));
    form.append('requestNo', requestNo);
    if (payload.externalReference) form.append('externalReference', String(payload.externalReference));
    await client.post('/mobile/upload-request-receipt', form, {
      headers: { 'Idempotency-Key': `${mutation.operationId}:attachment` }, timeout: 60_000,
    });
  }
  return response;
}

export async function processPendingMutationQueue(): Promise<number> {
  await syncAttendance().catch(() => undefined);
  const mutations = await getPendingMutations();
  if (mutations.length === 0) return 0;
  const client = await getClient();
  let accepted = 0;
  for (const mutation of mutations) {
    try {
      const rawPayload = JSON.parse(mutation.payload);
      const response = await executeQueuedRequest(client, mutation, rawPayload);
      if (Number.isFinite(rawPayload?.gpsLatitude) && Number.isFinite(rawPayload?.gpsLongitude)) {
        await saveGpsPoint({
          latitude: rawPayload.gpsLatitude, longitude: rawPayload.gpsLongitude,
          accuracy: rawPayload.gpsAccuracy,
          entityTable: mutation.endpoint === '/collections' ? 'collections' : 'payment_promises',
          entityId: response.data?.id,
        });
      }
      await markOfflineRequestResult(mutation.operationId, 'synced');
      await removeMutation(mutation.id);
      accepted += 1;
    } catch (error: any) {
      const message = syncErrorMessage(error);
      const httpStatus = error?.response?.status;
      if (retryableSyncStatus(httpStatus)) {
        await incrementRetry(mutation.id, message);
        await markOfflineRequestResult(mutation.operationId, 'pending', message);
      } else {
        await blockMutation(mutation.id, `HTTP ${httpStatus}: ${message}`);
        await markOfflineRequestResult(mutation.operationId, 'blocked', message);
      }
    }
  }
  return accepted;
}

export async function syncPendingGpsQueue(): Promise<number> {
  const points = await getUnsyncedGps();
  if (points.length === 0) return 0;
  await uploadGps(points.map((point: any) => ({
    latitude: point.latitude, longitude: point.longitude, accuracy: point.accuracy,
    entityTable: point.entityTable, entityId: point.entityId, recordedAt: point.recordedAt,
  })));
  await markGpsSynced(points.map((point: any) => point.id));
  return points.length;
}

export async function pullLatestMobileSnapshot(): Promise<void> {
  const [lastToken, hasOfflineInventory] = await Promise.all([getMeta('syncToken'), hasInventoryCatalogOffline()]);
  const response = await fetchSync(hasOfflineInventory ? (lastToken || undefined) : undefined);
  const data = response.data;
  await applySyncSnapshot({
    customers: data.customers || [], tasks: data.tasks || [], followups: data.followups || [],
    promises: data.promises || [], collections: data.collections || [], reservations: data.reservations || [],
    references: data.references || {}, newDebt: data.newDebt ?? null, customerAlerts: data.customerAlerts ?? null,
  }, data.syncToken);
  try { await fetchCustomerOrdersOfflineSnapshot(); } catch { /* preserve last valid local snapshot */ }
      try { await fetchQuotationsOfflineSnapshot(); } catch { /* preserve last complete quotation snapshot */ }
  try { await rescheduleOfflineReminders(); } catch (error) { console.warn('[BackgroundSync] reminders unavailable', error); }
}

export async function backgroundSyncOnce(): Promise<{ uploaded: number; gps: number; pending: number; blocked: number }> {
  const uploaded = await processPendingMutationQueue();
  let gps = 0;
  try { gps = await syncPendingGpsQueue(); } catch { /* GPS never blocks business sync */ }
  await pullLatestMobileSnapshot();
  const queue = await getMutationQueueStats();
  return { uploaded, gps, pending: queue.pending, blocked: queue.blocked };
}
