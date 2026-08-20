import React from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../store/auth-context';
import Loading from '../components/loading';
import LoginScreen from '../screens/login';
import DashboardScreen from '../screens/dashboard';
import TasksScreen from '../screens/tasks';
import CustomersScreen from '../screens/customers';
import AdvancesScreen from '../screens/advances';
import Customer360Screen from '../screens/customer-360';
import NewFollowupScreen from '../screens/new-followup';
import NewPromiseScreen from '../screens/new-promise';
import NewCollectionScreen from '../screens/new-collection';
import FollowupsListScreen from '../screens/followups-list';
import CollectionsListScreen from '../screens/collections-list';
import NewTaskScreen from '../screens/new-task';
import UploadReceiptScreen from '../screens/upload-receipt';
import NotificationsScreen from '../screens/notifications';
import ProfileScreen from '../screens/profile';
import SettingsScreen from '../screens/settings';
import CustomerLocationPickerScreen from '../screens/customer-location-picker';
import MessageTemplatesScreen from '../screens/message-templates';
import PromisesListScreen from '../screens/promises-list';
import ReservationsScreen from '../screens/reservations';
import NewReservationScreen from '../screens/new-reservation';
import InventoryScreen from '../screens/inventory';
import InventoryItemScreen from '../screens/inventory-item';
import { colors } from '../theme';
import * as Notifications from 'expo-notifications';
import { notificationNavigationTarget } from '../utils/notification-navigation';
import { canUseMobileFeature } from '../utils/mobile-permissions';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef<any>();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
    Dashboard: focused ? 'grid' : 'grid-outline',
    Tasks: focused ? 'checkbox' : 'checkbox-outline',
    Customers: focused ? 'people' : 'people-outline',
    Advances: focused ? 'wallet' : 'wallet-outline',
    Profile: focused ? 'person-circle' : 'person-circle-outline',
  };
  return (
    <View style={{
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: focused ? colors.gold : 'transparent',
      transform: [{ translateY: focused ? -7 : 0 }],
      ...(focused ? {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 7,
        elevation: 7,
      } : {}),
    }}>
      <Ionicons
        name={icons[name] || 'document-outline'}
        size={focused ? 24 : 22}
        color={focused ? colors.primary : colors.background}
      />
    </View>
  );
}

function MainTabs() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 10);
  const permissions = user?.permissions ?? [];
  const canViewTasks = canUseMobileFeature(permissions, 'mobile.tasks.view', 'tasks.manage');
  const canViewCustomers = permissions.includes('mobile.delivery.customers.view_all_no_balance')
    || canUseMobileFeature(permissions, 'mobile.customers.view', 'customers.read');
  const canViewAdvances = canUseMobileFeature(permissions, 'mobile.advances.view', 'customers.read');
  return (
    <Tab.Navigator screenOptions={({ route }) => ({
      headerStyle: { backgroundColor: colors.primary },
      headerTintColor: '#fff',
      headerTitleStyle: { fontFamily: 'Tajawal', fontWeight: '800', fontSize: 20 },
      tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
      tabBarActiveTintColor: colors.gold,
      tabBarInactiveTintColor: colors.background,
      tabBarHideOnKeyboard: true,
      tabBarLabelStyle: { fontFamily: 'Tajawal', fontSize: 11, fontWeight: '800', marginTop: 1 },
      tabBarItemStyle: { paddingTop: 6 },
      tabBarStyle: {
        backgroundColor: colors.primary,
        borderTopWidth: 1,
        borderTopColor: colors.goldDark,
        height: 66 + bottomInset,
        paddingTop: 7,
        paddingBottom: bottomInset,
        elevation: 18,
        shadowColor: '#001F1A',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.18,
        shadowRadius: 10,
      },
    })}>
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'الرئيسية', headerShown: false }} />
      {canViewTasks && <Tab.Screen name="Tasks" component={TasksScreen} options={{ title: 'المهام' }} />}
      {canViewCustomers && <Tab.Screen name="Customers" component={CustomersScreen} options={{ title: 'العملاء', headerShown: false }} />}
      {canViewAdvances && <Tab.Screen name="Advances" component={AdvancesScreen} options={{ title: 'السلف', headerShown: false }} />}
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'حسابي' }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  React.useEffect(() => {
    if (!isAuthenticated) return;
    const open = (data: Record<string, any> = {}) => {
      if (!navigationRef.isReady()) return;
      const target = notificationNavigationTarget(String(data.kind || ''), data);
      navigationRef.navigate(target.route, target.params);
    };
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification.request.content.data as Record<string, any>);
    });
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response.notification.request.content.data as Record<string, any>);
    }).catch(() => undefined);
    return () => subscription.remove();
  }, [isAuthenticated]);
  if (isLoading) return <Loading />;

  return (
    <NavigationContainer ref={navigationRef}>
      {isAuthenticated ? (
        <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.primary }, headerTintColor: '#fff', headerTitleStyle: { fontFamily: 'Tajawal', fontWeight: '800', fontSize: 20 }, headerTitleAlign: 'center' }}>
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="Customer360" component={Customer360Screen} options={{ title: 'تفاصيل الحساب' }} />
          <Stack.Screen name="NewFollowup" component={NewFollowupScreen} options={{ title: 'متابعة جديدة' }} />
          <Stack.Screen name="NewPromise" component={NewPromiseScreen} options={{ title: 'وعد سداد' }} />
          <Stack.Screen name="NewCollection" component={NewCollectionScreen} options={{ title: 'تحصيل جديد' }} />
          <Stack.Screen name="FollowupsList" component={FollowupsListScreen} options={{ title: 'المتابعات' }} />
          <Stack.Screen name="CollectionsList" component={CollectionsListScreen} options={{ title: 'التحصيلات' }} />
          <Stack.Screen name="NewTask" component={NewTaskScreen} options={{ title: 'مهمة جديدة' }} />
          <Stack.Screen name="UploadReceipt" component={UploadReceiptScreen} options={{ title: 'رفع سند' }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'الإعدادات' }} />
          <Stack.Screen name="CustomerLocationPicker" component={CustomerLocationPickerScreen} options={{ title: 'تحديد موقع العميل' }} />
          <Stack.Screen name="MessageTemplates" component={MessageTemplatesScreen} options={{ title: 'قوالب الرسائل' }} />
          <Stack.Screen name="PromisesList" component={PromisesListScreen} options={{ title: 'وعود السداد' }} />
          <Stack.Screen name="Reservations" component={ReservationsScreen} options={{ title: 'حجوزات البضاعة' }} />
          <Stack.Screen name="NewReservation" component={NewReservationScreen} options={{ title: 'إضافة حجز بضاعة' }} />
          <Stack.Screen name="Inventory" component={InventoryScreen} options={{ title: 'المخزون' }} />
          <Stack.Screen name="InventoryItem" component={InventoryItemScreen} options={{ title: 'تفاصيل الصنف' }} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'الإشعارات' }} />
        </Stack.Navigator>
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Login" component={LoginScreen} /></Stack.Navigator>
      )}
    </NavigationContainer>
  );
}
