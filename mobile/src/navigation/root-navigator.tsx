import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

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
import { colors } from '../theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
    Dashboard: focused ? 'grid' : 'grid-outline',
    Tasks: focused ? 'checkbox' : 'checkbox-outline',
    Customers: focused ? 'people' : 'people-outline',
    Advances: focused ? 'wallet' : 'wallet-outline',
    Profile: focused ? 'person-circle' : 'person-circle-outline',
  };
  return <Ionicons name={icons[name] || 'document-outline'} size={23} color={focused ? colors.gold : '#81908C'} />;
}

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={({ route }) => ({
      headerStyle: { backgroundColor: colors.primary },
      headerTintColor: '#fff',
      headerTitleStyle: { fontWeight: '800' },
      tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: '#81908C',
      tabBarLabelStyle: { fontSize: 11, fontWeight: '700', marginBottom: 5 },
      tabBarStyle: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line, height: 67, paddingTop: 7 },
    })}>
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'الرئيسية', headerShown: false }} />
      <Tab.Screen name="Tasks" component={TasksScreen} options={{ title: 'المهام' }} />
      <Tab.Screen name="Customers" component={CustomersScreen} options={{ title: 'العملاء', headerShown: false }} />
      <Tab.Screen name="Advances" component={AdvancesScreen} options={{ title: 'السلف', headerShown: false }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'حسابي' }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <Loading />;

  return (
    <NavigationContainer>
      {isAuthenticated ? (
        <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.primary }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: '800' } }}>
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
          <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'الإشعارات' }} />
        </Stack.Navigator>
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Login" component={LoginScreen} /></Stack.Navigator>
      )}
    </NavigationContainer>
  );
}
