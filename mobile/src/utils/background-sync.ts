import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { getAccessToken } from './secure-storage';
import { prepareOnlineRoute } from '../config/api';
import { backgroundSyncOnce } from './sync-operations';

export const BACKGROUND_SYNC_TASK = 'albinaa-background-business-sync';

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    if (!await getAccessToken()) return BackgroundFetch.BackgroundFetchResult.NoData;
    const health = await prepareOnlineRoute(3_500);
    if (!health.ok) return BackgroundFetch.BackgroundFetchResult.NoData;
    const result = await backgroundSyncOnce();
    return result.uploaded > 0 || result.gps > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBusinessBackgroundSync(): Promise<boolean> {
  const available = await TaskManager.isAvailableAsync();
  if (!available) return false;
  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
  if (!registered) {
    await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: 15 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  }
  return true;
}

export async function unregisterBusinessBackgroundSync(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)) {
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
  }
}
