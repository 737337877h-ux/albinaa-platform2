export const COLLECTOR_APP = 'com.albinaa.collector';
export const OPERATIONS_APP = 'com.alraqi.operations';
export function pushSoundForDevice(device?: {applicationId?: string; notificationChannelId?: string | null}, kind = '') {
  if (device?.applicationId === COLLECTOR_APP && device.notificationChannelId === 'albinaa-collection-created-v1' && kind === 'collection_created') {
    return {channelId:'albinaa-collection-created-v1',sound:'collection_success.mp3'};
  }
  return device?.applicationId === OPERATIONS_APP && device.notificationChannelId === 'alraqi-operations-sms-v1'
    ? {channelId: 'alraqi-operations-sms-v1', sound: 'alraqi_sms.m4a'}
    : {channelId: 'albinaa-reminders', sound: 'default'};
}
export function isOperationsKind(kind: string): boolean {
  return ['hr_', 'inventory_', 'quotation_', 'sales_order_', 'purchase_'].some(prefix => kind.startsWith(prefix)) || kind === 'sync_failed';
}

// Personal HR stays shared; specialized operational alerts belong to Operations.
export function pushDevicesForKind<T extends { applicationId?: string }>(kind: string, devices: T[], payload?: Record<string, unknown>): T[] {
  const operations = devices.filter(d => d.applicationId === OPERATIONS_APP);
  if (kind.startsWith('hr_') && payload?.reviewerEvent === true) return operations;
  if (kind.startsWith('hr_') && operations.length) return operations;
  if (kind.startsWith('hr_')) return devices.filter(d => !d.applicationId || d.applicationId === COLLECTOR_APP);
  if (kind === 'sync_failed') return devices;
  if (isOperationsKind(kind)) return operations;
  return devices.filter(d => !d.applicationId || d.applicationId === COLLECTOR_APP);
}
