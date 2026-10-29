import NativePlatformTool from '../screens/native-platform-tool';
import OperationsTabs from './operations-tabs';
import HrMyPayroll from '../screens/hr-my-payroll';
import { isOperationsApp } from '../config/product';
import { canOpenAppRoute } from '../utils/app-access';
import { ToolPage, ToolText } from '../components/native-tools';
import {platformTools} from '../utils/platform-tools';
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
import RequestCenterScreen from '../screens/request-center';
import RequestVoucherScreen from '../screens/request-voucher';
import RequestPurchaseScreen from '../screens/request-purchase';
import RequestJournalScreen from '../screens/request-journal';
import RequestInventoryTransferScreen from '../screens/request-inventory-transfer';
import NewInventoryCountScreen from '../screens/new-inventory-count';
import DebtChangeDetailsScreen from '../screens/debt-change-details';
import { colors, fonts } from '../theme';
import AppearanceMenu from '../components/appearance-menu';
import * as Notifications from 'expo-notifications';
import { notificationNavigationTarget } from '../utils/notification-navigation';
import { canUseMobileFeature } from '../utils/mobile-permissions';
import MobileUpdatePrompt from '../components/mobile-update-prompt';
import CustomerOrdersScreen from '../screens/customer-orders';
import QuotationsScreen from '../screens/quotations';
import HrRequestsScreen from '../screens/hr-requests';
import HrAttendanceScreen from '../screens/hr-attendance';
import HrCenter from '../screens/hr-center';
import HrRequestReview from '../screens/hr-request-review';
import HrTasksScreen from '../screens/hr-tasks';
import HrTaskReview from '../screens/hr-task-review';
import {useQueryClient} from '@tanstack/react-query';
import NewQuotationScreen from '../screens/new-quotation';
import NewCustomerOrderScreen from '../screens/new-customer-order';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef<any>();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
    Dashboard: focused ? 'grid' : 'grid-outline',
    Tasks: focused ? 'checkbox' : 'checkbox-outline',
    Customers: focused ? 'people' : 'people-outline',
    Advances: focused ? 'wallet' : 'wallet-outline',
    Profile: 'menu-outline',
    Requests: focused ? 'documents' : 'documents-outline',
  };
  return (
    <View style={{
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: focused ? colors.primarySoft : 'transparent',
      transform: [{ translateY: 0 }],
      ...(focused ? {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0,
        shadowRadius: 7,
        elevation: 0,
      } : {}),
    }}>
      <Ionicons
        name={icons[name] || 'document-outline'}
        size={focused ? 24 : 22}
        color={focused ? colors.primary : colors.muted}
      />
    </View>
  );
}

function MainTabs() {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 10);
  const permissions = user?.permissions ?? [];
  const canViewTasks = canUseMobileFeature(permissions, 'mobile.tasks.view', 'tasks.manage');
  const canViewCustomers = permissions.includes('mobile.delivery.customers.view_all_no_balance')
    || canUseMobileFeature(permissions, 'mobile.customers.view', 'customers.read');
  const canViewAdvances = canUseMobileFeature(permissions, 'mobile.advances.view', 'customers.read');
  const canViewRequests = permissions.some((permission) => ['oracle_test_requests.receipt.create','oracle_test_requests.payment.create','oracle_test_requests.journal.create'].includes(permission));
  return (
    <>
    <AppearanceMenu visible={menuOpen} onClose={() => setMenuOpen(false)} permissions={permissions} onNavigate={(route) => {
      if (route === 'Profile') navigationRef.navigate('Main', { screen: 'Profile' });
      else navigationRef.navigate(route);
    }} />
    <Tab.Navigator screenOptions={({ route }) => ({
      headerStyle: { backgroundColor: colors.primary },
      headerTintColor: '#fff',
      headerTitleStyle: { fontFamily: fonts.bold, fontWeight: '700', fontSize: 20 },
      tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.muted,
      tabBarHideOnKeyboard: true,
      tabBarLabelStyle: { fontFamily: fonts.bold, fontSize: 12, fontWeight: '700', marginTop: 1 },
      tabBarItemStyle: { paddingTop: 6 },
      tabBarStyle: {
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.line,
        height: 72 + bottomInset,
        paddingTop: 7,
        paddingBottom: bottomInset,
        elevation: 3,
        shadowColor: '#001F1A',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.04,
        shadowRadius: 10,
      },
    })}>
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'الرئيسية', headerShown: false }} />
      {canViewTasks && <Tab.Screen name="Tasks" component={TasksScreen} options={{ title: 'مهام التحصيل' }} />}
      {canViewCustomers && <Tab.Screen name="Customers" component={CustomersScreen} options={{ title: 'العملاء', headerShown: false }} />}
      {canViewAdvances && <Tab.Screen name="Advances" component={AdvancesScreen} options={{ title: 'سلف العملاء', headerShown: false }} />}
      {canViewRequests && <Tab.Screen name="Requests" component={RequestCenterScreen} options={{ title: 'السندات', headerShown: false }} />}
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'حسابي', tabBarLabel: 'المزيد' }} listeners={{ tabPress: (event) => { event.preventDefault(); setMenuOpen(true); } }} />
    </Tab.Navigator>
    </>
  );
}

export default function RootNavigator() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const pendingResponse = React.useRef<Notifications.NotificationResponse | null>(null);
  const handledResponse = React.useRef('');
  const flushNotification = React.useCallback(() => {
    const response = pendingResponse.current;
    if (!response || !isAuthenticated || !navigationRef.isReady() || !navigationRef.getRootState()?.routeNames.includes('Main')) return;
    const id = response.notification.request.identifier + ':' + response.actionIdentifier;
    pendingResponse.current = null;
    if (handledResponse.current === id) return;
    handledResponse.current = id;
    for (const key of ['notifications','hr-tasks','hr-task-review','hr-requests','hr-review']) void queryClient.invalidateQueries({queryKey:[key]});
    const data = response.notification.request.content.data as Record<string, any>;
    const target = notificationNavigationTarget(String(data.kind || ''), data);
    if (canOpenAppRoute(target.route, user?.permissions ?? [])) navigationRef.navigate(target.route, target.params);
    else navigationRef.navigate('Notifications');
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }, [isAuthenticated,queryClient,user?.permissions]);
  React.useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      pendingResponse.current = response; flushNotification();
    });
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) { pendingResponse.current = response; flushNotification(); }
    }).catch(() => undefined);
    flushNotification();
    return () => subscription.remove();
  }, [flushNotification]);
  React.useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(() => {
      if (isAuthenticated) for (const key of ['notifications','hr-tasks','hr-task-review','hr-requests','hr-review']) void queryClient.invalidateQueries({queryKey:[key]});
    });
    return () => subscription.remove();
  }, [isAuthenticated,queryClient]);
  if (isLoading) return <Loading />;

  return (
    <>
    <MobileUpdatePrompt />
    <NavigationContainer ref={navigationRef} onReady={flushNotification} onStateChange={flushNotification}>
      {isAuthenticated ? (
        <Stack.Navigator screenLayout={({ children, route }) => !canOpenAppRoute(route.name, user?.permissions ?? []) ? <ToolPage title="غير متاح"><ToolText>هذه الوظيفة ليست ضمن هذا التطبيق أو صلاحيات حسابك.</ToolText></ToolPage> : <>{children}</>} screenOptions={{ headerStyle: { backgroundColor: colors.primary }, headerTintColor: '#fff', headerTitleStyle: { fontFamily: fonts.bold, fontWeight: '700', fontSize: 20 }, headerTitleAlign: 'center' }}>
          <Stack.Screen name="Main" component={isOperationsApp ? OperationsTabs : MainTabs} options={{ headerShown: false }} />{platformTools.filter(t=>canOpenAppRoute(t.route,user?.permissions??[])).map(t=><Stack.Screen key={t.route} name={t.route} component={NativePlatformTool} options={{title:t.title}}/>)}
          {canOpenAppRoute('Customer360',user?.permissions??[]) && <Stack.Screen name="Customer360" component={Customer360Screen} options={{ title: 'تفاصيل الحساب' }} />}
          {canOpenAppRoute('NewFollowup',user?.permissions??[]) && <Stack.Screen name="NewFollowup" component={NewFollowupScreen} options={{ title: 'متابعة جديدة' }} />}
          {canOpenAppRoute('NewPromise',user?.permissions??[]) && <Stack.Screen name="NewPromise" component={NewPromiseScreen} options={{ title: 'وعد سداد' }} />}
          {canOpenAppRoute('NewCollection',user?.permissions??[]) && <Stack.Screen name="NewCollection" component={RequestVoucherScreen} initialParams={{ kind: 'receipt' }} options={{ title: 'تحصيل' }} />}
          {canOpenAppRoute('FollowupsList',user?.permissions??[]) && <Stack.Screen name="FollowupsList" component={FollowupsListScreen} options={{ title: 'المتابعات' }} />}
          {canOpenAppRoute('CollectionsList',user?.permissions??[]) && <Stack.Screen name="CollectionsList" component={CollectionsListScreen} options={{ title: 'التحصيلات' }} />}
          {canOpenAppRoute('NewTask',user?.permissions??[]) && <Stack.Screen name="NewTask" component={NewTaskScreen} options={{ title: 'مهمة جديدة' }} />}
          {canOpenAppRoute('UploadReceipt',user?.permissions??[]) && <Stack.Screen name="UploadReceipt" component={UploadReceiptScreen} options={{ title: 'رفع سند' }} />}
          {canOpenAppRoute('Settings',user?.permissions??[]) && <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'الإعدادات' }} />}
          {canOpenAppRoute('CustomerLocationPicker',user?.permissions??[]) && <Stack.Screen name="CustomerLocationPicker" component={CustomerLocationPickerScreen} options={{ title: 'تحديد موقع العميل' }} />}
          {canOpenAppRoute('MessageTemplates',user?.permissions??[]) && <Stack.Screen name="MessageTemplates" component={MessageTemplatesScreen} options={{ title: 'قوالب الرسائل' }} />}
          {canOpenAppRoute('PromisesList',user?.permissions??[]) && <Stack.Screen name="PromisesList" component={PromisesListScreen} options={{ title: 'وعود السداد' }} />}
          {canOpenAppRoute('Reservations',user?.permissions??[]) && <Stack.Screen name="Reservations" component={ReservationsScreen} options={{ title: 'حجوزات البضاعة' }} />}
          {canOpenAppRoute('NewReservation',user?.permissions??[]) && <Stack.Screen name="NewReservation" component={NewReservationScreen} options={{ title: 'إضافة حجز بضاعة' }} />}
          {canOpenAppRoute('Inventory',user?.permissions??[]) && <Stack.Screen name="Inventory" component={InventoryScreen} options={{ title: 'المخزون' }} />}
          {canOpenAppRoute('InventoryItem',user?.permissions??[]) && <Stack.Screen name="InventoryItem" component={InventoryItemScreen} options={{ title: 'تفاصيل الصنف' }} />}
          {canOpenAppRoute('RequestCenter',user?.permissions??[]) && <Stack.Screen name="RequestCenter" component={RequestCenterScreen} options={{ title: 'عمليات ONYX' }} />}
          {canOpenAppRoute('Quotations',user?.permissions??[]) && <Stack.Screen name="Quotations" component={QuotationsScreen} options={{ title: 'عروض الأسعار' }} />}
          {canOpenAppRoute('HrCenter',user?.permissions??[]) && <Stack.Screen name="HrCenter" component={HrCenter} options={{title:'خدمات الموظفين'}}/>}{canOpenAppRoute('HrRequestReview',user?.permissions??[]) && <Stack.Screen name="HrRequestReview" component={HrRequestReview} options={{title:'مراجعة طلبات الموظفين'}}/>}{canOpenAppRoute('HrRequests',user?.permissions??[]) && <Stack.Screen name="HrRequests" component={HrRequestsScreen} options={{ title: 'طلبات السلف والإجازات' }} />}
          {canOpenAppRoute('HrAttendance',user?.permissions??[]) && <Stack.Screen name="HrAttendance" component={HrAttendanceScreen} options={{ title: 'الحضور والانصراف' }} />}
          {canOpenAppRoute('HrMyPayroll',user?.permissions??[]) && <Stack.Screen name="HrMyPayroll" component={HrMyPayroll} options={{ title: 'كشف راتبي' }} />}
          {canOpenAppRoute('HrTasks',user?.permissions??[]) && <Stack.Screen name="HrTasks" component={HrTasksScreen} options={{ title: 'مهامي اليومية' }} />}
          {canOpenAppRoute('HrTaskReview',user?.permissions??[]) && <Stack.Screen name="HrTaskReview" component={HrTaskReview} options={{ title: 'مراجعة مهام الموظفين' }} />}
          {canOpenAppRoute('NewQuotation',user?.permissions??[]) && <Stack.Screen name="NewQuotation" component={NewQuotationScreen} options={{ title: 'عرض سعر جديد' }} />}
          {canOpenAppRoute('CustomerOrders',user?.permissions??[]) && <Stack.Screen name="CustomerOrders" component={CustomerOrdersScreen} options={{ title: 'طلبات العملاء' }} />}
          {canOpenAppRoute('NewCustomerOrder',user?.permissions??[]) && <Stack.Screen name="NewCustomerOrder" component={NewCustomerOrderScreen} options={{ title: 'طلب مبيعات عميل' }} />}
          {canOpenAppRoute('RequestVoucher',user?.permissions??[]) && <Stack.Screen name="RequestVoucher" component={RequestVoucherScreen} options={({ route }: any) => ({ title: route.params?.kind === 'payment' ? 'طلب سند صرف' : 'طلب سند قبض' })} />}
          {canOpenAppRoute('RequestPurchase',user?.permissions??[]) && <Stack.Screen name="RequestPurchase" component={RequestPurchaseScreen} options={{ title: 'طلب شراء' }} />}
          {canOpenAppRoute('RequestJournal',user?.permissions??[]) && <Stack.Screen name="RequestJournal" component={RequestJournalScreen} options={{ title: 'طلب قيد يومي' }} />}
          {canOpenAppRoute('RequestInventoryTransfer',user?.permissions??[]) && <Stack.Screen name="RequestInventoryTransfer" component={RequestInventoryTransferScreen} options={{ title: 'طلب تحويل مخزني' }} />}
          {canOpenAppRoute('NewInventoryCount',user?.permissions??[]) && <Stack.Screen name="NewInventoryCount" component={NewInventoryCountScreen} options={{ title: 'إنشاء جرد' }} />}
          {canOpenAppRoute('DebtChangeDetails',user?.permissions??[]) && <Stack.Screen name="DebtChangeDetails" component={DebtChangeDetailsScreen} options={{ title: 'تغير المديونية خلال 24 ساعة' }} />}
          {canOpenAppRoute('Notifications',user?.permissions??[]) && <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'الإشعارات' }} />}
        </Stack.Navigator>
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Login" component={LoginScreen} /></Stack.Navigator>
      )}
    </NavigationContainer>
    </>
  );
}
