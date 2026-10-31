import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { api } from './api';
import { usePublishedInventoryVersion } from './use-published-inventory-version';
vi.mock('./api', () => ({ api: vi.fn() }));

describe('published inventory revision refresh', () => {
  it('reloads an unchanged item search when a new snapshot renames the item', async () => {
    let version = 'snapshot-a';
    vi.mocked(api).mockImplementation(async path => path === '/oracle-inventory/catalog-version'
      ? { version } : { name: version === 'snapshot-a' ? 'Old name' : 'New name' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, unmount } = renderHook(() => {
      const revision = usePublishedInventoryVersion(true);
      return useQuery<{ name: string }>({ queryKey: ['barcode-items', 'same-search', revision], queryFn: () => api('/items') }).data?.name;
    }, { wrapper });
    await waitFor(() => expect(result.current).toBe('Old name'));
    version = 'snapshot-b';
    await client.invalidateQueries({ queryKey: ['published-inventory-version'] });
    await waitFor(() => expect(result.current).toBe('New name'));
    unmount(); client.clear();
  });
});
