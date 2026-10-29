import { Alert, Platform } from 'react-native';
import { isOperationsApp, product } from '../config/product';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { getClient } from '../api/client';
import { getBaseUrl } from '../config/api';
import { getAccessToken } from './secure-storage';

export type MobileAppRelease = {
  id: string;
  versionName: string;
  versionCode: number;
  notes: string;
  mandatory: boolean;
  status: 'published';
  size: number;
  sha256: string;
  downloadPath: string;
  application?: 'collector' | 'operations';
  packageId?: string;
};

export type MobileUpdateProgress = {
  written: number;
  total: number;
  fraction: number;
};

export function currentBuildNumber(): number {
  return Number(Constants.nativeBuildVersion ?? Constants.expoConfig?.android?.versionCode ?? 0);
}

export function validateReleaseApplication(release: MobileAppRelease): void {
  const application = isOperationsApp ? 'operations' : 'collector';
  if ((release.application && release.application !== application)
    || (release.packageId && release.packageId !== product.packageId)
    || (isOperationsApp && (!release.packageId || !release.application))) {
    throw new Error('هذا التحديث يخص تطبيقًا آخر');
  }
  const path = `/mobile-app-releases/${encodeURIComponent(release.id)}/download`;
  if (release.downloadPath !== path + `?application=${application}` && !(application === 'collector' && release.downloadPath === path)) {
    throw new Error('رابط التحديث لا يطابق قناة التطبيق');
  }
}

export async function fetchAvailableMobileUpdate(): Promise<MobileAppRelease | null> {
  const client = await getClient();
  const response = await client.get<MobileAppRelease | null>(`/mobile-app-releases/latest?application=${isOperationsApp ? 'operations' : 'collector'}`);
  const release = response.data;
  if (release) validateReleaseApplication(release);
  return release && Number(release.versionCode) > currentBuildNumber() ? release : null;
}

export async function downloadAndInstallMobileUpdate(
  release: MobileAppRelease,
  onProgress?: (progress: MobileUpdateProgress) => void,
): Promise<void> {
  validateReleaseApplication(release);
  if (Platform.OS !== 'android') throw new Error('التثبيت المحلي متاح على Android فقط');
  const baseUrl = (await getBaseUrl()).replace(/\/+$/, '');
  const token = await getAccessToken();
  const root = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}mobile-updates/`;
  await FileSystem.makeDirectoryAsync(root, { intermediates: true });
  const target = `${root}${product.packageId}-${release.versionCode}.apk`;
  const resumable = FileSystem.createDownloadResumable(
    `${baseUrl}${release.downloadPath}`,
    target,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      const total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : release.size;
      onProgress?.({
        written: totalBytesWritten,
        total,
        fraction: total > 0 ? Math.min(1, totalBytesWritten / total) : 0,
      });
    },
  );
  const result = await resumable.downloadAsync();
  if (!result) throw new Error('توقف تنزيل التحديث قبل اكتماله');
  if (result.status !== 200) throw new Error(`تعذر تنزيل التحديث (HTTP ${result.status})`);
  onProgress?.({ written: release.size, total: release.size, fraction: 1 });
  const contentUri = await FileSystem.getContentUriAsync(result.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1,
    type: 'application/vnd.android.package-archive',
  });
}

export function showUpdateError(error: unknown) {
  Alert.alert('تعذر تثبيت التحديث', (error as any)?.message || 'تحقق من الشبكة المحلية ثم حاول مرة أخرى.');
}
