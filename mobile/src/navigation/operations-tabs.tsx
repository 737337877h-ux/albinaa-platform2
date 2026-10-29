import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../store/auth-context';
import { colors, fonts } from '../theme';
import OperationsHome, { OperationsInventory, OperationsTasks, OperationsServices } from '../screens/operations-home';
import RequestCenter from '../screens/request-center';
import { canOpenOperationsRoute } from '../utils/operations-access';

const Tab = createBottomTabNavigator();
const icons: Record<string, keyof typeof Ionicons.glyphMap> = { Dashboard: 'home-outline', Requests: 'documents-outline', Stock: 'cube-outline', EmployeeTasks: 'checkbox-outline', Services: 'person-outline' };
export default function OperationsTabs() {
  const permissions = useAuth().user?.permissions ?? [];
  const bottom = Math.max(useSafeAreaInsets().bottom, 10);
  return <Tab.Navigator screenOptions={({ route }) => ({
    headerShown: false, tabBarHideOnKeyboard: true,
    tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.muted,
    tabBarIcon: ({ color }) => <Ionicons name={icons[route.name]} size={23} color={color} />,
    tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12, paddingTop: 3 },
    tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, paddingTop: 9, paddingBottom: bottom, height: 64 + bottom },
    sceneStyle: { backgroundColor: colors.background },
  })}>
    <Tab.Screen name="Dashboard" component={OperationsHome} options={{ title: 'الرئيسية' }} />
    {canOpenOperationsRoute('RequestCenter', permissions) && <Tab.Screen name="Requests" component={RequestCenter} options={{ title: 'الطلبات', headerShown: true }} />}
    {['Inventory', 'NewInventoryCount', 'RequestInventoryTransfer', 'BarcodeDesign', 'Reservations'].some(r => canOpenOperationsRoute(r, permissions)) && <Tab.Screen name="Stock" component={OperationsInventory} options={{ title: 'المخزون', headerShown: true }} />}
    <Tab.Screen name="EmployeeTasks" component={OperationsTasks} options={{ title: 'المهام', headerShown: true }} />
    <Tab.Screen name="Services" component={OperationsServices} options={{ title: 'خدماتي', headerShown: true }} />
  </Tab.Navigator>;
}
