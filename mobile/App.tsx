import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider } from './src/store/auth-context';
import { SyncProvider } from './src/store/sync-context';
import RootNavigator from './src/navigation/root-navigator';
import { initializeLocalNotifications } from './src/utils/local-notifications';
import { restoreGpsTracking } from './src/utils/gps';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
    mutations: {
      retry: 1,
    },
  },
});

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: any, info: any) {
    console.error('App Error:', error, info?.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0f4f8' }}>
          <Text style={{ fontSize: 18, color: '#333', marginBottom: 16 }}>حدث خطأ غير متوقع</Text>
          <Text style={{ fontSize: 14, color: '#666' }}>يرجى إعادة تشغيل التطبيق</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

import { View, Text } from 'react-native';

export default function App() {
  React.useEffect(() => {
    initializeLocalNotifications().catch(() => undefined);
    restoreGpsTracking().catch(() => undefined);
  }, []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SyncProvider>
            <ErrorBoundary>
              <StatusBar style="light" />
              <RootNavigator />
            </ErrorBoundary>
          </SyncProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
