import React, { createContext, useContext, useEffect, useRef, ReactNode } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { fetchSync, uploadGps } from '../api/endpoints';
import {
  getMeta, setMeta, upsert, getPendingMutations, removeMutation, incrementRetry,
  getUnsyncedGps, markGpsSynced,
} from '../db/database';
import { useAuth } from './auth-context';
import { SYNC_INTERVAL_MS } from '../utils/constants';

interface SyncContextValue {
  triggerSync: () => Promise<void>;
  processQueue: () => Promise<void>;
  syncGps: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue>({
  triggerSync: async () => {},
  processQueue: async () => {},
  syncGps: async () => {},
});

export function SyncProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const processQueue = async () => {
    const mutations = await getPendingMutations();
    for (const m of mutations) {
      try {
        const { default: client } = await import('../api/client');
        const payload = JSON.parse(m.payload);
        await client({
          method: m.type.toLowerCase(),
          url: m.endpoint,
          data: payload,
          headers: { 'Idempotency-Key': m.operationId },
        });
        await removeMutation(m.id);
      } catch (err: any) {
        if (err?.response?.status && err.response.status < 500 && err.response.status !== 409) {
          await removeMutation(m.id);
        } else {
          await incrementRetry(m.id, err.message);
          if (m.retryCount >= 5) await removeMutation(m.id);
        }
      }
    }
  };

  const syncGps = async () => {
    const points = await getUnsyncedGps();
    if (points.length === 0) return;
    try {
      const batch = points.map((p: any) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy: p.accuracy,
        entityTable: p.entityTable,
        entityId: p.entityId,
        recordedAt: p.recordedAt,
      }));
      await uploadGps(batch);
      await markGpsSynced(points.map((p: any) => p.id));
    } catch { /* will retry next cycle */ }
  };

  const triggerSync = async () => {
    if (!isAuthenticated) return;
    try {
      const lastToken = await getMeta('syncToken');
      const res = await fetchSync(lastToken || undefined);
      const { syncToken, tasks, customers, followups, promises, collections } = res.data;
      await setMeta('syncToken', syncToken);
      for (const c of customers) await upsert('customers', { ...c, balances: JSON.stringify(c.balances || []) });
      for (const t of tasks) await upsert('tasks', t);
      for (const f of followups) await upsert('followups', f);
      for (const p of promises) await upsert('promises', p);
      for (const c of collections) await upsert('collections', c);
    } catch { /* will retry next cycle */ }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    triggerSync();
    intervalRef.current = setInterval(() => {
      triggerSync();
      processQueue();
      syncGps();
    }, SYNC_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') triggerSync();
    });
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      sub.remove();
    };
  }, [isAuthenticated]);

  return (
    <SyncContext.Provider value={{ triggerSync, processQueue, syncGps }}>
      {children}
    </SyncContext.Provider>
  );
}

export const useSync = () => useContext(SyncContext);
