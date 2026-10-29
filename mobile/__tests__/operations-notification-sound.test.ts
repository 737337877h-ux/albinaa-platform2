/// <reference types="jest" />
jest.mock('react-native', () => ({Platform: {OS: 'android'}}));
jest.mock('expo-constants', () => ({__esModule:true,default:{expoConfig:{extra:{applicationVariant:'operations'}}}}));
jest.mock('expo-notifications', () => ({
  AndroidImportance: {HIGH:4}, setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({granted:true}),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/db/database', () => ({getAll:jest.fn(),getMutationQueueStats:jest.fn()}));
import * as Notifications from 'expo-notifications';
import {initializeLocalNotifications} from '../src/utils/local-notifications';
test('registers the operations sound on a new high importance channel',async()=>{
  await expect(initializeLocalNotifications()).resolves.toBe(true);
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('alraqi-operations-sms-v1',expect.objectContaining({sound:'alraqi_sms.m4a',importance:4,name:'تنبيهات الطلبات والمخزون والموظفين'}));
});
