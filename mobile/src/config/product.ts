import Constants from 'expo-constants';

export const isOperationsApp = Constants.expoConfig?.extra?.applicationVariant === 'operations';
export const product = {
  id: isOperationsApp ? 'operations' : 'collector',
  name: isOperationsApp ? 'الراقي إدارة العملاء والمخزون' : 'ALRAQi ERP',
  subtitle: isOperationsApp ? 'إدارة العملاء والمخزون' : 'إدارة المديونية والتحصيل',
  packageId: isOperationsApp ? 'com.alraqi.operations' : 'com.albinaa.collector',
  notificationChannelId: isOperationsApp ? 'alraqi-operations-sms-v1' : 'albinaa-reminders',
  notificationSound: isOperationsApp ? 'alraqi_sms.m4a' : 'news_flash.mp3',
  collectionChannelId: 'albinaa-collection-created-v1',
  pushConfigured: !isOperationsApp || Constants.expoConfig?.extra?.operationsPushConfigured === true,
} as const;
