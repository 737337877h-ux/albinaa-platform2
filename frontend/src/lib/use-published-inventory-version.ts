'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** Lightweight revision check; catalog queries include this value in their key. */
export function usePublishedInventoryVersion(enabled: boolean) {
  return useQuery<{ version: string }>({
    queryKey: ['published-inventory-version'],
    queryFn: () => api('/oracle-inventory/catalog-version'),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: 'always',
  }).data?.version;
}
