import React from 'react';
import { reportUserActivity } from './src/utils/session-lock';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import tajawalRegular from './assets/fonts/Tajawal-Regular.ttf';
import tajawalMedium from './assets/fonts/Tajawal-Medium.ttf';
import tajawalBold from './assets/fonts/Tajawal-Bold.ttf';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nManager, Text, TextInput, View } from 'react-native';

import { AuthProvider } from './src/store/auth-context';
import { SyncProvider } from './src/store/sync-context';
import RootNavigator from './src/navigation/root-navigator';
import { initializeLocalNotifications } from './src/utils/local-notifications';
import { restoreGpsTracking } from './src/utils/gps';
import { colors } from './src/theme';

I18nManager.allowRTL(true);
I18nManager.forceRTL(true);
I18nManager.swapLeftAndRightInRTL(true);

const defaultTextStyle = { fontFamily: 'TajawalRegular', fontSize: 15, writingDirection: 'rtl' as const };
const TextComponent = Text as typeof Text & { defaultProps?: Record<string, unknown> };
const TextInputComponent = TextInput as typeof TextInput & { defaultProps?: Record<string, unknown> };
TextComponent.defaultProps = {
  ...(TextComponent.defaultProps || {}),
  style: [defaultTextStyle, TextComponent.defaultProps?.style],
};
TextInputComponent.defaultProps = {
  onChange: reportUserActivity,
  onKeyPress: reportUserActivity,
  ...(TextInputComponent.defaultProps || {}),
  style: [defaultTextStyle, { fontSize: 16 }, TextInputComponent.defaultProps?.style],
};

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
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.primary, marginBottom: 16 }}>حدث خطأ غير متوقع</Text>
          <Text style={{ fontSize: 14, color: colors.muted }}>يرجى إعادة تشغيل التطبيق</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    TajawalRegular: tajawalRegular,
    TajawalMedium: tajawalMedium,
    TajawalBold: tajawalBold,
  });
  React.useEffect(() => {
    initializeLocalNotifications().catch(() => undefined);
    restoreGpsTracking().catch(() => undefined);
  }, []);
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: colors.primary }} />;
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
