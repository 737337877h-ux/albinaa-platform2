import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, afterEach, test, expect } from '@jest/globals';

const { installProductHook } = require('../scripts/native-product.cjs');
let root: string;
const write = (file: string, content: string) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'alraqi-native-'));
  write('android/app/build.gradle', 'android { }\n');
  write('android/build.gradle', 'buildscript { dependencies { } }');
  write('android/app/src/main/AndroidManifest.xml', '<application android:label="@string/app_name" android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round"><data android:scheme="albinaa"/></application>');
  write('android/app/src/main/java/com/albinaa/collector/MainApplication.kt', 'val packages = PackageList(this).packages.apply {\n}\n');
  write('native/android/StatementSharePackage.kt', 'package com.albinaa.collector\nclass StatementSharePackage');
});
afterEach(() => {
  const resolved = path.resolve(root);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('alraqi-native-')) throw Error('Unsafe test cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
});
test('installs the native share bridge and product selection once after a clean prebuild', () => {
  installProductHook(root);
  const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
  installProductHook(root);
  expect(fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8')).toBe(gradle);
  expect(gradle).toContain('alraqiFirebaseFile.exists()');
  expect(fs.readFileSync(path.join(root, 'android/build.gradle'), 'utf8')).not.toContain('com.google.gms:');
  const main = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/albinaa/collector/MainApplication.kt'), 'utf8');
  expect(main.match(/add\(com.albinaa.collector.StatementSharePackage\(\)\)/g)).toHaveLength(1);
  expect(fs.existsSync(path.join(root, 'android/app/src/main/java/com/albinaa/collector/StatementSharePackage.kt'))).toBe(true);
});
test('adds the Google Services build dependency once when private registration exists', () => {
  write('config/operations/google-services.json', '{}');
  installProductHook(root);installProductHook(root);
  const build = fs.readFileSync(path.join(root, 'android/build.gradle'), 'utf8');
  expect(build.match(/com.google.gms:google-services:/g)).toHaveLength(1);
});
