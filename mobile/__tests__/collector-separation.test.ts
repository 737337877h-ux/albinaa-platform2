/// <reference types="jest" />
jest.mock('expo-constants',()=>({__esModule:true,default:{expoConfig:{extra:{}}}}));
jest.mock('react-native',()=>({Platform:{OS:'android'}}));
jest.mock('expo-notifications',()=>({AndroidImportance:{HIGH:4},setNotificationHandler:jest.fn(),getPermissionsAsync:jest.fn().mockResolvedValue({granted:true}),setNotificationChannelAsync:jest.fn().mockResolvedValue(undefined)}));
jest.mock('../src/db/database',()=>({getAll:jest.fn(),getMutationQueueStats:jest.fn()}));
import {canOpenAppRoute,isAppDocument} from '../src/utils/app-access';
import {initializeLocalNotifications} from '../src/utils/local-notifications';
import * as Notifications from 'expo-notifications';
test('collector excludes moved routes even with administrator permissions and keeps finance and personal HR',()=>{
  for(const route of ['Inventory','InventoryItem','Reservations','NewReservation','BarcodeDesign','NewInventoryCount','RequestInventoryTransfer','CustomerOrders','NewCustomerOrder','Quotations','NewQuotation','RequestPurchase','AssignHrTask','HrTaskReview','HrRequestReview']) expect(canOpenAppRoute(route,['users.manage','hr.tasks.manage','inventory.read','reports.read'])).toBe(false);
  for(const route of ['Customer360','NewCollection','CollectionsList','FollowupsList','PromisesList','AssignTask','ManageAssignments','RequestVoucher','HrAttendance','HrRequests','HrTasks','HrMyPayroll']) expect(canOpenAppRoute(route,[])).toBe(true);
  expect(isAppDocument('receipt')).toBe(true);expect(isAppDocument('quotation')).toBe(false);
});
test('collector retains its old channel and adds a separate new-collection tone',async()=>{
  await initializeLocalNotifications();
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('albinaa-reminders',expect.objectContaining({sound:'news_flash.mp3'}));
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('albinaa-collection-created-v1',expect.objectContaining({sound:'collection_success.mp3'}));
  expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalledWith('alraqi-operations-sms-v1',expect.anything());
});
