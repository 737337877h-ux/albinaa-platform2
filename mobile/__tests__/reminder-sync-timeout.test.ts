/// <reference types="jest" />
jest.mock('react-native', () => ({Platform: {OS: 'android'}}));
jest.mock('expo-constants', () => ({__esModule: true, default: {expoConfig:{extra:{}}}}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(), getPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
}));
jest.mock('../src/db/database', () => ({getAll: jest.fn().mockResolvedValue([]), getMutationQueueStats: jest.fn().mockResolvedValue({blocked:0})}));
import * as Notifications from 'expo-notifications';
import {rescheduleOfflineReminders} from '../src/utils/local-notifications';
test('native notification hang times out without duplicating native calls; completion permits retry', async () => {
 jest.useFakeTimers();
 let finish!: (value:any)=>void;
 (Notifications.getPermissionsAsync as jest.Mock).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
 const first=rescheduleOfflineReminders();
 const rejected=expect(first).rejects.toThrow('التذكيرات');
 await jest.advanceTimersByTimeAsync(8000); await rejected;
 const second=rescheduleOfflineReminders();
 expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(1);
 finish({granted:false});
 await expect(second).resolves.toBe(0);
 (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({granted:false});
 await expect(rescheduleOfflineReminders()).resolves.toBe(0);
 expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(2);
 jest.useRealTimers();
});
