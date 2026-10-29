/// <reference types="jest" />
jest.mock('react-native', () => ({Alert: {}, Platform: {OS: 'android'}}));
jest.mock('expo-constants', () => ({__esModule: true, default: {nativeBuildVersion: '2'}}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-intent-launcher', () => ({}));
jest.mock('../src/api/client', () => ({getClient: jest.fn()}));
jest.mock('../src/config/api', () => ({getBaseUrl: jest.fn()}));
jest.mock('../src/utils/secure-storage', () => ({getAccessToken: jest.fn()}));
jest.mock('../src/config/product', () => ({isOperationsApp: true, product: {packageId: 'com.alraqi.operations'}}));
import {validateReleaseApplication, fetchAvailableMobileUpdate, MobileAppRelease} from '../src/utils/mobile-update';
import {getClient} from '../src/api/client';

const release: MobileAppRelease = {id:'r', versionName:'1.0.2', versionCode:3, notes:'', mandatory:false, status:'published', size:1, sha256:'hash', application:'operations', packageId:'com.alraqi.operations', downloadPath:'/mobile-app-releases/r/download?application=operations'};
test('accepts the operations package only on its own download channel', () => {
  expect(() => validateReleaseApplication(release)).not.toThrow();
  for (const patch of [{application:'collector'}, {packageId:'com.albinaa.collector'}, {application:undefined}, {packageId:undefined}, {downloadPath:'/mobile-app-releases/r/download'}, {downloadPath:'https://example.com/app.apk'}]) {
    expect(() => validateReleaseApplication({...release,...patch} as MobileAppRelease)).toThrow();
  }
});
test('fetches only the operations feed and rejects a mismatched returned release', async () => {
  const get = jest.fn().mockResolvedValue({data: release});
  (getClient as jest.Mock).mockResolvedValue({get});
  await expect(fetchAvailableMobileUpdate()).resolves.toEqual(release);
  expect(get).toHaveBeenCalledWith('/mobile-app-releases/latest?application=operations');
  get.mockResolvedValue({data:{...release,packageId:'com.albinaa.collector'}});
  await expect(fetchAvailableMobileUpdate()).rejects.toThrow();
  get.mockResolvedValue({data:{...release,versionCode:2}});
  await expect(fetchAvailableMobileUpdate()).resolves.toBeNull();
});
