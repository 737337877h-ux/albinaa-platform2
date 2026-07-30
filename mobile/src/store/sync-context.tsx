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

const TABLE_COLUMNS: Record<string, string[]> = {
  customers: ['id', 'fullName', 'phonePrimary', 'address', 'balances'],
  tasks: ['id', 'customerId', 'customerName', 'title', 'dueDate', 'priority', 'status'],
  followups: ['id', 'customerId', 'customerName', 'typeName', 'resultName', 'notes', 'followupAt'],
  promises: ['id', 'customerId', 'customerName', 'expectedAmount', 'currencyCode', 'dueDate', 'status', 'notes'],
  collections: ['id', 'customerId', 'customerName', 'amount', 'currencyCode', 'methodName', 'notes', 'collectedAt'],
};

function pickColumns(table: string, record: Record<string, any>) {
  const allowed = TABLE_COLUMNS[table] || Object.keys(record);
  const out: Record<string, any> = {};
  for (const key of allowed) {
    if (record[key] !== undefined) out[key] = record[key];
  }
  if (!out.id) return null;
  return out;
}

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

      // Dedupe by id in case backend sent duplicates (defense in depth)
      const dedupeById = <T extends { id: string }>(arr: T[]): T[] => {
        const seen = new Set<string>();
        const out: T[] = [];
        for (const item of arr) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          out.push(item);
        }
        return out;
      };

      // Clean SQLite of any existing duplicates BEFORE inserting fresh data
      const { dedupeTable } = await import('../db/database');
      await dedupeTable('customers');
      await dedupeTable('tasks');
      await dedupeTable('followups');
      await dedupeTable('promises');
      await dedupeTable('collections');

      const uniqueCustomers = dedupeById(customers || []);
      for (const c of uniqueCustomers) {
        const row = pickColumns('customers', {
          ...c,
          balances: typeof c.balances === 'string' ? c.balances : JSON.stringify(c.balances || []),
        });
        if (row) await upsert('customers', row);
      }
      for (const t of dedupeById(tasks || [])) {
        const row = pickColumns('tasks', t);
        if (row) await upsert('tasks', row);
      }
      for (const f of dedupeById(followups || [])) {
        const row = pickColumns('followups', f);
        if (row) await upsert('followups', row);
      }
      for (const p of dedupeById(promises || [])) {
        const row = pickColumns('promises', p);
        if (row) await upsert('promises', row);
      }
      for (const c of dedupeById(collections || [])) {
        const row = pickColumns('collections', c);
        if (row) await upsert('collections', row);
      }
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
