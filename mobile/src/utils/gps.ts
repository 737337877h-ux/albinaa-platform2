import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { saveGpsPoint } from '../db/database';

const GEOFENCE_TASK = 'alraqi-workplace-geofence';
const TRACKING_KEY = 'alraqi.gps_enabled';
const WORKPLACE_KEY = 'alraqi.workplace';
let watchSubscription: Location.LocationSubscription | null = null;

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const event = data as { eventType: Location.GeofencingEventType; region: Location.LocationRegion };
  if (event.eventType === Location.GeofencingEventType.Enter) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'وصلت إلى موقع العمل',
        body: 'الخادم المحلي قريب. افتح تطبيق الراقي لمزامنة العمليات المحفوظة.',
        data: { route: 'Settings', action: 'sync' },
        sound: true,
      },
      trigger: null,
    });
  }
});

export async function requestGpsPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function requestBackgroundGpsPermission(): Promise<boolean> {
  const { status } = await Location.requestBackgroundPermissionsAsync();
  return status === 'granted';
}

export async function startGpsTracking() {
  if (watchSubscription) return;
  await SecureStore.setItemAsync(TRACKING_KEY, 'true');
  watchSubscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, distanceInterval: 25, timeInterval: 60_000 },
    async (loc) => saveGpsPoint({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy ?? undefined }),
  );
}

export async function restoreGpsTracking(): Promise<boolean> {
  const enabled = (await SecureStore.getItemAsync(TRACKING_KEY)) === 'true';
  if (!enabled) return false;
  const permission = await Location.getForegroundPermissionsAsync();
  if (permission.status === 'granted') await startGpsTracking();
  return permission.status === 'granted';
}

export async function stopGpsTracking() {
  watchSubscription?.remove();
  watchSubscription = null;
  await SecureStore.setItemAsync(TRACKING_KEY, 'false');
}

export async function getCurrentPosition() {
  const recent = await Location.getLastKnownPositionAsync({ maxAge: 120_000, requiredAccuracy: 250 });
  const loc = recent || await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy ?? undefined };
}

export async function setCurrentLocationAsWorkplace(radius = 180) {
  const point = await getCurrentPosition();
  const workplace = { latitude: point.latitude, longitude: point.longitude, radius };
  await SecureStore.setItemAsync(WORKPLACE_KEY, JSON.stringify(workplace));
  const background = await Location.getBackgroundPermissionsAsync();
  if (background.status !== 'granted') throw new Error('يلزم السماح بالموقع دائماً لتشغيل تنبيه الوصول');
  await Location.startGeofencingAsync(GEOFENCE_TASK, [{ identifier: 'workplace', notifyOnEnter: true, notifyOnExit: false, ...workplace }]);
  return workplace;
}

export async function getWorkplace(): Promise<{ latitude: number; longitude: number; radius: number } | null> {
  const raw = await SecureStore.getItemAsync(WORKPLACE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
