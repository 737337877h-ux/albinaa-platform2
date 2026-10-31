import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import configFile from '../app.json';

const factory = require('../app.config.js');
const originalApp = process.env.ALRAQI_APP;
beforeEach(() => { delete process.env.ALRAQI_APP; });
afterEach(() => {
  jest.restoreAllMocks();
  if (originalApp === undefined) delete process.env.ALRAQI_APP;
  else process.env.ALRAQI_APP = originalApp;
});

describe('independent application identities', () => {
  test('collector source configuration works without private Firebase files', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    const result = factory({ config: configFile.expo });
    expect(result.version).toBe('1.3.74');
    expect(result.android).toMatchObject({ package: 'com.albinaa.collector', versionCode: 78 });
    expect(result.android.googleServicesFile).toBeUndefined();
  });
  test('operations uses its own package, version, scheme and notification sound', () => {
    process.env.ALRAQI_APP = 'operations';
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    const result = factory({ config: configFile.expo });
    expect(result.version).toBe('1.0.10');
    expect(result.android).toMatchObject({ package: 'com.alraqi.operations', versionCode: 11 });
    expect(result.scheme).toBe('alraqi-operations');
    expect(result.extra.operationsPushConfigured).toBe(false);
    expect(result.plugins.find((p: any) => Array.isArray(p) && p[0] === 'expo-notifications')[1].sounds)
      .toEqual(['./native/operations-res/raw/alraqi_sms.m4a']);
    expect(configFile.expo.android.package).toBe('com.albinaa.collector');
  });
  test('private Firebase registrations are selected independently', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const collector = factory({ config: configFile.expo });
    process.env.ALRAQI_APP = 'operations';
    const operations = factory({ config: configFile.expo });
    expect(collector.android.googleServicesFile).toBe(path.resolve(__dirname, '../google-services.json'));
    expect(operations.android.googleServicesFile).toBe(path.resolve(__dirname, '../config/operations/google-services.json'));
    expect(operations.extra.operationsPushConfigured).toBe(true);
  });
});
