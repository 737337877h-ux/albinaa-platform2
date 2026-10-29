import {isOperationsApp} from '../config/product';
import {syncAttendance} from '../utils/attendance-offline';
import { fetchQuotationsOfflineSnapshot } from '../api/quotations';
import { submitQueuedQuotation } from '../utils/quotation-sync';
import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { fetchCustomerOrdersOfflineSnapshot, fetchSync, uploadGps } from '../api/endpoints';
import {
  applySyncSnapshot, blockMutation, getMeta, getMutationQueueStats,
  getPendingMutations, getUnsyncedGps, hasInventoryCatalogOffline, incrementRetry, markGpsSynced,
  markOfflineRequestResult, removeMutation, retryBlockedMutations, retryPendingMutationsNow, saveGpsPoint,
} from '../db/database';
import { useAuth } from './auth-context';
import { SYNC_INTERVAL_MS } from '../utils/constants';
import {
  getLanOnlySync, prepareOnlineRoute,
} from '../config/api';
import { rescheduleOfflineReminders } from '../utils/local-notifications';
import { resolveCustomerOrderEndpoint, submitQueuedCustomerOrder, submitQueuedOracleCustomerOrder } from '../utils/customer-order-sync';
import { westernDigits } from '../utils/date-input';

const GATEWAY_REQUEST_TIMEOUT_MS = 120_000;

export type SyncPhase = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  stage?: string;
  reminderWarning?: string;
  lastSyncAt: string | null;
  pending: number;
  blocked: number;
  lastError: string | null;
  lanOnly: boolean;
}

interface SyncContextValue {
  triggerSync: () => Promise<void>;
  processQueue: () => Promise<void>;
  syncGps: () => Promise<void>;
  retryBlocked: () => Promise<void>;
  retryPending: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  status: SyncStatus;
}

const INITIAL_STATUS: SyncStatus = {
  phase: 'idle', lastSyncAt: null, pending: 0, blocked: 0, lastError: null, lanOnly: true,
};

const SyncContext = createContext<SyncContextValue>({
  triggerSync: async () => {},
  processQueue: async () => {},
  syncGps: async () => {},
  retryBlocked: async () => {},
  retryPending: async () => {},
  refreshStatus: async () => {},
  status: INITIAL_STATUS,
});

function retryableStatus(status?: number): boolean {
  return status === undefined || status === 401 || status === 408 || status === 425 || status === 429 || status >= 500;
}

function errorMessage(error: any): string {
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

function normalizeQueuedOracleDocumentNumbers(endpoint: string, payload: any) {
  if (!String(endpoint).startsWith('/oracle-test-requests/') || !payload || typeof payload !== 'object') return payload;
  return {
    ...payload,
    referenceNo: typeof payload.referenceNo === 'string' ? westernDigits(payload.referenceNo) : payload.referenceNo,
    noticeNo: typeof payload.noticeNo === 'string' ? westernDigits(payload.noticeNo) : payload.noticeNo,
  };
}

async function executeQueuedRequest(client: any, mutation: any, rawPayload: any) {
  const {
    __attachmentUri: attachmentUri,
    __attachmentName: attachmentName,
    __offlineWorkflow: offlineWorkflow,
    ...rawBusinessPayload
  } = rawPayload || {};
  const payload = normalizeQueuedOracleDocumentNumbers(
    mutation.endpoint,
    sanitizeLegacyGpsPayload(mutation.endpoint, rawBusinessPayload),
  );
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
    const created = await client.post('/inventory-transfers', payload, { headers, timeout: GATEWAY_REQUEST_TIMEOUT_MS });
    const id = created.data?.id;
    if (!id) throw new Error('لم يُرجع الخادم رقم مسودة التحويل');
    const checked = await client.post(`/inventory-transfers/${id}/dry-run`, undefined, { timeout: GATEWAY_REQUEST_TIMEOUT_MS });
    if (checked.data?.valid !== true) {
      const issue = (checked.data?.issues || []).map((item: any) => item.message).filter(Boolean).join('، ');
      const error: any = new Error(issue || 'لم ينجح فحص التحويل المخزني');
      error.response = { status: 422, data: { message: error.message } };
      throw error;
    }
    return client.post(`/inventory-transfers/${id}/submit`, undefined, {
      headers: { 'Idempotency-Key': `${mutation.operationId}:submit` },
      timeout: GATEWAY_REQUEST_TIMEOUT_MS,
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
    const checked = await client.post(`${mutation.endpoint}/dry-run`, payload, {
      headers,
      timeout: GATEWAY_REQUEST_TIMEOUT_MS,
    });
    if (checked.data?.valid === false || checked.data?.saveAllowed === false) {
      const issue = (checked.data?.issues || []).map((item: any) => item.message).filter(Boolean).join('، ');
      const error: any = new Error(issue || checked.data?.saveBlockedReason || 'لم يسمح فحص Oracle بحفظ المسودة');
      error.response = { status: 422, data: { message: error.message } };
      throw error;
    }
  }
  const endpoint = await resolveCustomerOrderEndpoint(mutation.endpoint);
  const response = await client({
    method: mutation.type.toLowerCase(), url: endpoint, data: payload, headers,
    ...(String(mutation.endpoint).startsWith('/oracle-test-requests/')
      ? { timeout: GATEWAY_REQUEST_TIMEOUT_MS }
      : {}),
  });
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
      headers: { 'Idempotency-Key': `${mutation.operationId}:attachment` },
      timeout: 60_000,
    });
  }
  return response;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, refreshUser } = useAuth();
  const [status, setStatus] = useState<SyncStatus>(INITIAL_STATUS);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncingRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    const [queue, lastSyncAt, lanOnly] = await Promise.all([
      getMutationQueueStats(), getMeta('lastSyncAt'), getLanOnlySync(),
    ]);
    setStatus((current) => ({ ...current, ...queue, lastSyncAt, lanOnly }));
  }, []);

  const processQueue = useCallback(async () => {
    await syncAttendance().catch(() => undefined);
    const mutations = await getPendingMutations();
    if (mutations.length === 0) return;
    const { getClient } = await import('../api/client');
    const client = await getClient();
    for (const mutation of mutations) {
      try {
        const rawPayload = JSON.parse(mutation.payload);
        const response = await executeQueuedRequest(client, mutation, rawPayload);
        if (Number.isFinite(rawPayload?.gpsLatitude) && Number.isFinite(rawPayload?.gpsLongitude)) {
          await saveGpsPoint({
            latitude: rawPayload.gpsLatitude,
            longitude: rawPayload.gpsLongitude,
            accuracy: rawPayload.gpsAccuracy,
            entityTable: mutation.endpoint === '/collections' ? 'collections' : 'payment_promises',
            entityId: response.data?.id,
          });
        }
        await markOfflineRequestResult(mutation.operationId, 'synced');
        await removeMutation(mutation.id);
      } catch (error: any) {
        const message = errorMessage(error);
        const httpStatus = error?.response?.status;
        if (retryableStatus(httpStatus)) {
          await incrementRetry(mutation.id, message);
          await markOfflineRequestResult(mutation.operationId, 'pending', message);
        } else {
          await blockMutation(mutation.id, `HTTP ${httpStatus}: ${message}`);
          await markOfflineRequestResult(mutation.operationId, 'blocked', message);
        }
      }
    }
  }, []);

  const syncGps = useCallback(async () => {
    const points = await getUnsyncedGps();
    if (points.length === 0) return;
    const batch = points.map((point: any) => ({
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy: point.accuracy,
      entityTable: point.entityTable,
      entityId: point.entityId,
      recordedAt: point.recordedAt,
    }));
    await uploadGps(batch);
    await markGpsSynced(points.map((point: any) => point.id));
  }, []);

  const triggerSync = useCallback(async () => {
    if (!isAuthenticated || syncingRef.current) return;
    syncingRef.current = true;
    const stage = (name: string) => { console.info('[Sync] '+name); setStatus(current => ({...current, stage:name})); };
    stage('فحص الاتصال');
    setStatus((current) => ({ ...current, phase: 'syncing', lastError: null }));
    try {
      const lanOnly = await getLanOnlySync();
      const health = await prepareOnlineRoute(3_500);
      if (!health.ok) {
        const offlineError = new Error(health.error || 'الخادم المحلي غير متاح');
        (offlineError as any).offline = true;
        throw offlineError;
      }

      // Push first so a subsequent pull contains the accepted server records.
      stage('إرسال العمليات المحلية');
      await processQueue();
      stage('إرسال المواقع');
      try { await syncGps(); } catch { /* GPS must not block business data */ }

      const [lastToken, hasOfflineInventory] = await Promise.all([
        getMeta('syncToken'),
        hasInventoryCatalogOffline(),
      ]);
      // A mobile upgrade can add the offline inventory tables while retaining
      // a recent sync token from the previous release. Omitting that token
      // once asks the server for the full Oracle catalog needed to seed them.
      stage('تنزيل البيانات');
      const response = await fetchSync(!isOperationsApp || hasOfflineInventory ? (lastToken || undefined) : undefined);
      const data = response.data;
      stage('حفظ البيانات على الهاتف');
      await applySyncSnapshot({
        customers: data.customers || [],
        tasks: data.tasks || [],
        followups: data.followups || [],
        promises: data.promises || [],
        collections: data.collections || [],
        reservations: data.reservations || [],
        references: data.references || {},
        newDebt: data.newDebt ?? null,
        customerAlerts: data.customerAlerts ?? null,
      }, data.syncToken);
      // طلبات العملاء مرآة قراءة مستقلة وكاملة. فشل صلاحيتها لا يمنع
      // مزامنة العملاء والمهام، وتبقى آخر لقطة محلية قابلة للاستخدام.
      if (isOperationsApp) {
      stage('تحديث طلبات العملاء');
      try { await fetchCustomerOrdersOfflineSnapshot(); } catch { /* keep the last local order snapshot */ }
      stage('تحديث عروض الأسعار');
      try { await fetchQuotationsOfflineSnapshot(); } catch { /* preserve last complete quotation snapshot */ }
      }
      stage('تحديث التذكيرات');
      let reminderWarning: string | undefined;
      try { await rescheduleOfflineReminders(); } catch (error) { reminderWarning = errorMessage(error); console.warn('[Sync] '+reminderWarning); }
      // The business snapshot is already committed locally at this point.
      // A transient profile refresh failure must not relabel a successful sync
      // as "Network Error"; the cached authenticated identity remains valid.
      stage('تحديث الصلاحيات');
      try { await refreshUser(); } catch { /* retry on the next foreground sync */ }
      const queue = await getMutationQueueStats();
      setStatus({
        phase: 'synced',
        stage: undefined,
        reminderWarning,
        lastSyncAt: new Date().toISOString(),
        ...queue,
        lastError: null,
        lanOnly,
      });
    } catch (error: any) {
      // Diagnostics must not throw the same database failure and leave the UI syncing.
      const queue = await getMutationQueueStats().catch(() => ({}));
      setStatus((current) => ({
        ...current,
        ...queue,
        phase: error?.offline || error?.message === 'Network Error' ? 'offline' : 'error',
        lastError: errorMessage(error),
      }));
    } finally {
      syncingRef.current = false;
    }
  }, [isAuthenticated, processQueue, refreshUser, syncGps]);

  const retryBlocked = useCallback(async () => {
    await retryBlockedMutations();
    await refreshStatus();
    await triggerSync();
  }, [refreshStatus, triggerSync]);

  const retryPending = useCallback(async () => {
    await retryPendingMutationsNow();
    await refreshStatus();
    await triggerSync();
  }, [refreshStatus, triggerSync]);

  useEffect(() => {
    refreshStatus().catch(() => undefined);
    if (!isAuthenticated) return;
    triggerSync();
    intervalRef.current = setInterval(triggerSync, SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') triggerSync();
    });
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      subscription.remove();
    };
  }, [isAuthenticated, refreshStatus, triggerSync]);

  return (
    <SyncContext.Provider value={{
      triggerSync, processQueue, syncGps, retryBlocked, retryPending, refreshStatus, status,
    }}>
      {children}
    </SyncContext.Provider>
  );
}

export const useSync = () => useContext(SyncContext);
