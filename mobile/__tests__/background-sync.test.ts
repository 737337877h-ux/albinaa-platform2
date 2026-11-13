import {beforeEach,describe,expect,it,jest} from '@jest/globals';
const mockRegistered=new Set<string>(),mockMeta=new Map<string,string>(),mockCallbacks=new Map<string,any>();
jest.mock('expo-task-manager',()=>({defineTask:(name:string,fn:any)=>mockCallbacks.set(name,fn),isAvailableAsync:jest.fn(async()=>true),isTaskRegisteredAsync:async(name:string)=>mockRegistered.has(name)}));
jest.mock('expo-background-task',()=>({BackgroundTaskResult:{Success:1,Failed:2},BackgroundTaskStatus:{Available:2,Restricted:1},getStatusAsync:jest.fn(async()=>2),registerTaskAsync:jest.fn(async(name:string)=>{mockRegistered.add(name);}),unregisterTaskAsync:jest.fn(async(name:string)=>{mockRegistered.delete(name);})}));
jest.mock('expo-background-fetch',()=>({BackgroundFetchResult:{NoData:1},unregisterTaskAsync:jest.fn(async(name:string)=>{mockRegistered.delete(name);})}));
jest.mock('../src/config/api',()=>({prepareOnlineRoute:jest.fn(async()=>({ok:true}))}));
jest.mock('../src/utils/business-session',()=>({assertBusinessSession:jest.fn(async()=>({owner:'org:u1'})),isSessionAccessError:(e:any)=>['SESSION_LOCKED','SESSION_CHANGED'].includes(e?.code)}));
jest.mock('../src/utils/sync-operations',()=>({backgroundSyncOnce:jest.fn(async()=>({uploaded:2,gps:0,pending:1,blocked:0}))}));
jest.mock('../src/db/database',()=>({getMeta:async(key:string)=>key==='dataOwner'?'org:u1':mockMeta.get(key)??null,setMeta:async(key:string,value:string)=>{mockMeta.set(key,value);}}));
import * as Task from 'expo-background-task';
import * as Legacy from 'expo-background-fetch';
import * as SecureStore from 'expo-secure-store';
import {assertBusinessSession} from '../src/utils/business-session';
import {prepareOnlineRoute} from '../src/config/api';
import {backgroundSyncOnce} from '../src/utils/sync-operations';
import {BACKGROUND_SYNC_TASK,PREVIOUS_BACKGROUND_SYNC_TASK,LEGACY_BACKGROUND_SYNC_TASK,registerBusinessBackgroundSync,unregisterBusinessBackgroundSync,runBusinessBackgroundSync,businessBackgroundSyncStatus} from '../src/utils/background-sync';
describe('background job lifecycle',()=>{
 beforeEach(async()=>{jest.clearAllMocks();mockRegistered.clear();mockMeta.clear();await SecureStore.setItemAsync('albinaa.background_sync.enabled','true');(assertBusinessSession as any).mockResolvedValue({owner:'org:u1'});(prepareOnlineRoute as any).mockResolvedValue({ok:true});});
 it('migrates legacy registration and uses minutes for the supported scheduler',async()=>{
  mockRegistered.add(LEGACY_BACKGROUND_SYNC_TASK);
  mockRegistered.add(PREVIOUS_BACKGROUND_SYNC_TASK);
  expect(await registerBusinessBackgroundSync()).toBe(true);
  expect(Legacy.unregisterTaskAsync).toHaveBeenCalledWith(LEGACY_BACKGROUND_SYNC_TASK);
  expect(Task.unregisterTaskAsync).toHaveBeenCalledWith(PREVIOUS_BACKGROUND_SYNC_TASK);
  expect((Task.unregisterTaskAsync as any).mock.invocationCallOrder[0]).toBeLessThan((Task.registerTaskAsync as any).mock.invocationCallOrder[0]);
  expect(mockRegistered.has(PREVIOUS_BACKGROUND_SYNC_TASK)).toBe(false);
  expect(Task.registerTaskAsync).toHaveBeenCalledWith(BACKGROUND_SYNC_TASK,{minimumInterval:15});
 });
 it('does not make any network call or process a queue while locked',async()=>{
  (assertBusinessSession as any).mockRejectedValue({code:'SESSION_LOCKED'});
  expect(await runBusinessBackgroundSync()).toBe(1);
  expect(prepareOnlineRoute).not.toHaveBeenCalled();expect(backgroundSyncOnce).not.toHaveBeenCalled();
  expect((await businessBackgroundSyncStatus()).lastRun?.outcome).toBe('locked');
 });
 it('keeps an offline attempt distinct from failure and preserves pending work',async()=>{
  (prepareOnlineRoute as any).mockResolvedValue({ok:false});await runBusinessBackgroundSync();
  expect(backgroundSyncOnce).not.toHaveBeenCalled();expect((await businessBackgroundSyncStatus()).lastRun?.outcome).toBe('offline');
 });
 it('records confirmed success and a separate success timestamp without user activity',async()=>{
  const first=runBusinessBackgroundSync();expect(runBusinessBackgroundSync()).toBe(first);await first;
  expect(backgroundSyncOnce).toHaveBeenCalledTimes(1);
  const status=await businessBackgroundSyncStatus();expect(status.lastRun).toMatchObject({outcome:'synced',uploaded:2,pending:1});expect(status.lastSuccessAt).toBeTruthy();
 });
 it('unregisters current and old schedulers on lock/sign-out',async()=>{
  mockRegistered.add(BACKGROUND_SYNC_TASK);mockRegistered.add(PREVIOUS_BACKGROUND_SYNC_TASK);mockRegistered.add(LEGACY_BACKGROUND_SYNC_TASK);await unregisterBusinessBackgroundSync();expect(mockRegistered.size).toBe(0);
 });
 it('retires a legacy wake-up instead of sending business data through it',async()=>{
  await mockCallbacks.get(LEGACY_BACKGROUND_SYNC_TASK)();expect(backgroundSyncOnce).not.toHaveBeenCalled();
 });
 it('retires a persisted v2 wake-up without sending data or renewing a session',async()=>{
  mockRegistered.add(PREVIOUS_BACKGROUND_SYNC_TASK);
  await mockCallbacks.get(PREVIOUS_BACKGROUND_SYNC_TASK)();
  expect(mockRegistered.size).toBe(0);expect(backgroundSyncOnce).not.toHaveBeenCalled();expect(prepareOnlineRoute).not.toHaveBeenCalled();expect(assertBusinessSession).not.toHaveBeenCalled();
 });
});
