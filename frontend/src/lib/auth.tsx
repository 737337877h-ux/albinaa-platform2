'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api, tokenStore } from './api';

export interface Me {
  id: string; username: string; fullName: string;
  organizationId: string; branchId: string | null;
  roles: string[]; permissions: string[];
}

export function useMe() {
  return useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me'),
    staleTime: 60_000,
    retry: false,
    enabled: typeof window !== 'undefined' && !!tokenStore.access,
  });
}

/** الصلاحيات في الواجهة تُخفي/تعطّل فقط — الحماية الأساسية تبقى في الـ API. */
export function useCan() {
  const { data } = useMe();
  return (perm: string) => data?.permissions.includes(perm) ?? false;
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return async () => {
    const rt = tokenStore.refresh;
    if (rt) await api('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: rt }) }).catch(() => null);
    tokenStore.clear();
    qc.clear();
    router.replace('/login');
  };
}
