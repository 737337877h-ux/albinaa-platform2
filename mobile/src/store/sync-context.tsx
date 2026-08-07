import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { fetchSync, uploadGps } from '../api/endpoints';
import {
  applySyncSnapshot, blockMutation, getMeta, getMutationQueueStats,
  getPendingMutations, getUnsyncedGps, incrementRetry, markGpsSynced,
  removeMutation, retryBlockedMutations,
} from '../db/database';
import { useAuth } from './auth-context';
import { SYNC_INTERVAL_MS } from '../utils/constants';
import {
  getBaseUrl, getLanOnlySync, isLocalNetworkUrl, pingServer,
} from '../config/api';
import { rescheduleOfflineReminders } from '../utils/local-notifications';

export type SyncPhase = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
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

export function SyncProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
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
    const mutations = await getPendingMutations();
    if (mutations.length === 0) return;
    const { getClient } = await import('../api/client');
    const client = await getClient();
    for (const mutation of mutations) {
      try {
        await client({
          method: mutation.type.toLowerCase(),
          url: mutation.endpoint,
          data: JSON.parse(mutation.payload),
          headers: { 'Idempotency-Key': mutation.operationId },
        });
        await removeMutation(mutation.id);
      } catch (error: any) {
        const message = errorMessage(error);
        const httpStatus = error?.response?.status;
        if (retryableStatus(httpStatus)) await incrementRetry(mutation.id, message);
        else await blockMutation(mutation.id, `HTTP ${httpStatus}: ${message}`);
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
    setStatus((current) => ({ ...current, phase: 'syncing', lastError: null }));
    try {
      const [baseUrl, lanOnly] = await Promise.all([getBaseUrl(), getLanOnlySync()]);
      if (lanOnly && !isLocalNetworkUrl(baseUrl)) {
        throw new Error('المزامنة المحلية مفعلة. أدخل عنوان الخادم داخل الشبكة مثل 192.168.x.x');
      }
      const health = await pingServer(baseUrl, 3_500);
      if (!health.ok) {
        const offlineError = new Error(health.error || 'الخادم المحلي غير متاح');
        (offlineError as any).offline = true;
        throw offlineError;
      }

      // Push first so a subsequent pull contains the accepted server records.
      await processQueue();
      try { await syncGps(); } catch { /* GPS must not block business data */ }

      const lastToken = await getMeta('syncToken');
      const response = await fetchSync(lastToken || undefined);
      const data = response.data;
      await applySyncSnapshot({
        customers: data.customers || [],
        tasks: data.tasks || [],
        followups: data.followups || [],
        promises: data.promises || [],
        collections: data.collections || [],
        references: data.references || {},
      }, data.syncToken);
      await rescheduleOfflineReminders();
      const queue = await getMutationQueueStats();
      setStatus({
        phase: 'synced',
        lastSyncAt: new Date().toISOString(),
        ...queue,
        lastError: null,
        lanOnly,
      });
    } catch (error: any) {
      const queue = await getMutationQueueStats();
      setStatus((current) => ({
        ...current,
        ...queue,
        phase: error?.offline || !error?.response ? 'offline' : 'error',
        lastError: errorMessage(error),
      }));
    } finally {
      syncingRef.current = false;
    }
  }, [isAuthenticated, processQueue, syncGps]);

  const retryBlocked = useCallback(async () => {
    await retryBlockedMutations();
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
      triggerSync, processQueue, syncGps, retryBlocked, refreshStatus, status,
    }}>
      {children}
    </SyncContext.Provider>
  );
}

export const useSync = () => useContext(SyncContext);
