import Constants from 'expo-constants';
import { product, isOperationsApp } from '../config/product';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getClient } from '../api/client';
import { initializeLocalNotifications } from './local-notifications';

async function getDevicePushToken(): Promise<string | null> {
  if (!product.pushConfigured) return null;
  if (!['android', 'ios'].includes(Platform.OS)) return null;
  const granted = await initializeLocalNotifications();
  if (!granted) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  const result = await Notifications.getExpoPushTokenAsync({ projectId });
  return result.data || null;
}

/** Best-effort registration; offline use and login never depend on Push availability. */
export async function registerPushDevice(): Promise<boolean> {
  try {
    const token = await getDevicePushToken();
    if (!token) return false;
    const client = await getClient();
    await client.post('/notifications/push-tokens', {
      token,
      platform: Platform.OS,
      applicationId: product.packageId,
      notificationChannelId: isOperationsApp ? product.notificationChannelId : product.collectionChannelId,
      deviceName: Platform.OS === 'android' ? `Android ${Platform.constants.Model}` : 'iOS collector device',
    });
    return true;
  } catch (error) {
    console.warn('[Push] تعذر تسجيل الجهاز:', error instanceof Error ? error.message : 'سبب غير معروف');
    return false;
  }
}

/** Best-effort removal while the authenticated session is still available. */
export async function unregisterPushDevice(): Promise<void> {
  try {
    const token = await getDevicePushToken();
    if (!token) return;
    const client = await getClient();
    await client.delete('/notifications/push-tokens', { data: { token } });
  } catch {
    // A disconnected device can still log out locally. The token is reassigned on next login.
  }
}
