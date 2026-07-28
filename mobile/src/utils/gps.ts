import * as Location from 'expo-location';
import { saveGpsPoint } from '../db/database';

let watchSubscription: Location.LocationSubscription | null = null;

export async function requestGpsPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function requestBackgroundGpsPermission(): Promise<boolean> {
  const { status } = await Location.requestBackgroundPermissionsAsync();
  return status === 'granted';
}

export async function startGpsTracking() {
  watchSubscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 10_000 },
    async (loc) => {
      await saveGpsPoint({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? undefined,
      });
    },
  );
}

export function stopGpsTracking() {
  if (watchSubscription) {
    watchSubscription.remove();
    watchSubscription = null;
  }
}

export async function getCurrentPosition() {
  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy: loc.coords.accuracy ?? undefined,
  };
}
