'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from '@/components/ui/toast';
import { ThemeProvider } from '@/lib/theme';

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: 30_000,      // 30 ثانية — يمنع إعادة جلب متكررة
        gcTime: 5 * 60_000,     // 5 دقائق cache retention
        refetchOnReconnect: 'always',
      },
    },
  }));
  return (
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
