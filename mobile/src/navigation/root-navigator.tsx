import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';

import { useAuth } from '../store/auth-context';
import Loading from '../components/loading';

import LoginScreen from '../screens/login';
import DashboardScreen from '../screens/dashboard';
import TasksScreen from '../screens/tasks';
import CustomersScreen from '../screens/customers';
import Customer360Screen from '../screens/customer-360';
import NewFollowupScreen from '../screens/new-followup';
import NewPromiseScreen from '../screens/new-promise';
import NewCollectionScreen from '../screens/new-collection';
import UploadReceiptScreen from '../screens/upload-receipt';
import NotificationsScreen from '../screens/notifications';
import ProfileScreen from '../screens/profile';
import SettingsScreen from '../screens/settings';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Dashboard: '🏠',
    Tasks: '📋',
    Customers: '👥',
    Notifications: '🔔',
    Profile: '👤',
  };
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{icons[name] || '📄'}</Text>;
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: '#1a73e8' },
        headerTintColor: '#fff',
        tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
        tabBarActiveTintColor: '#1a73e8',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee' },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'الرئيسية', headerShown: false }} />
      <Tab.Screen name="Tasks" component={TasksScreen} options={{ title: 'المهام' }} />
      <Tab.Screen name="Customers" component={CustomersScreen} options={{ title: 'العملاء' }} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'الإشعارات' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'الملف الشخصي' }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <Loading />;

  return (
    <NavigationContainer>
      {isAuthenticated ? (
        <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: '#1a73e8' }, headerTintColor: '#fff' }}>
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="Customer360" component={Customer360Screen} options={{ title: 'العميل' }} />
          <Stack.Screen name="NewFollowup" component={NewFollowupScreen} options={{ title: 'متابعة جديدة' }} />
          <Stack.Screen name="NewPromise" component={NewPromiseScreen} options={{ title: 'وعد سداد' }} />
          <Stack.Screen name="NewCollection" component={NewCollectionScreen} options={{ title: 'تحصيل جديد' }} />
          <Stack.Screen name="UploadReceipt" component={UploadReceiptScreen} options={{ title: 'رفع سند' }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'الإعدادات' }} />
        </Stack.Navigator>
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}
