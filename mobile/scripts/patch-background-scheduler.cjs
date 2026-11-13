const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

// Expo 57 defaults to a prebuilt AAR. package.json forces this one module to
// build from source; postinstall and both release scripts apply this patch.
const VERSION = '57.0.23';
const SOURCE = 'android/src/main/java/expo/modules/backgroundtask/BackgroundTaskScheduler.kt';
const UPSTREAM_SHA256 = 'f152dd5493cc59f5caab119fa14418a968cd051ef2f96514934b324c930b749c';
const PATCHED_SHA256 = '4fdd86e37bb9de65c928a6bce22824af8d732c516b594fb21aa763bd930380ea';
const replacements = [
  ['.setRequiredNetworkType(NetworkType.CONNECTED)',
    '// Office Wi-Fi may reach our server without Android-validated Internet.\n' +
    '      // JS checks the actual approved server and session before any business I/O.\n' +
    '      .setRequiredNetworkType(NetworkType.NOT_REQUIRED)'],
  ['builder.setInitialDelay(Duration.ofMinutes(overriddenIntervalMinutes))',
    '// Give newly registered sessions one opportunity before the 15-minute idle lock.\n' +
    '      // Subsequent one-time requests keep the configured 15-minute interval.\n' +
    '      val initialDelayMinutes = if (cancelExisting) 1L else overriddenIntervalMinutes\n' +
    '      builder.setInitialDelay(Duration.ofMinutes(initialDelayMinutes))'],
  ['return workInfos.firstOrNull()',
    '// A completed predecessor must not hide the active request in the chain.\n' +
    '      return workInfos.firstOrNull { it.state == WorkInfo.State.RUNNING }\n' +
    '        ?: workInfos.firstOrNull { it.state == WorkInfo.State.ENQUEUED }\n' +
    '        ?: workInfos.firstOrNull()'],
];
function digest(text) { return createHash('sha256').update(text).digest('hex'); }
function patchSource(input) {
  const source = input.replace(/\r\n/g, '\n');
  if (digest(source) === PATCHED_SHA256) return source;
  if (digest(source) !== UPSTREAM_SHA256) {
    throw new Error('Unrecognized Expo background scheduler source. Review the LAN patch before building.');
  }
  const patched = replacements.reduce((text, [before, after]) => text.replace(before, after), source);
  if (digest(patched) !== PATCHED_SHA256) throw new Error('Background scheduler patch integrity check failed.');
  return patched;
}
function patchBackgroundScheduler(root) {
  const moduleRoot = path.join(root, 'node_modules/expo-background-task');
  const info = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'package.json'), 'utf8'));
  if (info.version !== VERSION) throw new Error(`LAN background patch requires expo-background-task ${VERSION}; found ${info.version}.`);
  const target = path.join(moduleRoot, SOURCE);
  const source = fs.readFileSync(target, 'utf8');
  const patched = patchSource(source);
  if (patched !== source) fs.writeFileSync(target, patched);
}
if (require.main === module) patchBackgroundScheduler(path.resolve(__dirname, '..'));
module.exports = { patchBackgroundScheduler, patchSource };
