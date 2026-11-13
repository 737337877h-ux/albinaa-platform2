import * as BackgroundTask from 'expo-background-task';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import {prepareOnlineRoute} from '../config/api';
import {getMeta,setMeta} from '../db/database';
import {assertBusinessSession,isSessionAccessError} from './business-session';
import {backgroundSyncOnce} from './sync-operations';

export const BACKGROUND_SYNC_TASK='albinaa-background-business-sync-v3';
export const PREVIOUS_BACKGROUND_SYNC_TASK='albinaa-background-business-sync-v2';
export const LEGACY_BACKGROUND_SYNC_TASK='albinaa-background-business-sync';
const ENABLED='albinaa.background_sync.enabled';
let epoch=0,running:Promise<BackgroundTask.BackgroundTaskResult>|null=null;
export type BackgroundRun={attemptedAt:string;finishedAt:string;outcome:'synced'|'offline'|'locked'|'account_changed'|'failed';uploaded?:number;pending?:number;blocked?:number};
export async function businessBackgroundSyncEnabled(){return await SecureStore.getItemAsync(ENABLED)!=='false';}
async function saveRun(owner:string|null,run:BackgroundRun){if(owner&&await getMeta('dataOwner')===owner){await setMeta(`background.lastRun:${owner}`,JSON.stringify(run));if(run.outcome==='synced')await setMeta(`background.lastSuccess:${owner}`,run.finishedAt);}}
async function run(){
 const attemptedAt=new Date().toISOString();let owner:string|null=null;
 try{
  if(!await businessBackgroundSyncEnabled())return BackgroundTask.BackgroundTaskResult.Success;
  owner=await getMeta('dataOwner');
  const session=await assertBusinessSession(owner??undefined);owner=session.owner;
  const health=await prepareOnlineRoute(3500);
  if(!health.ok){await saveRun(owner,{attemptedAt,finishedAt:new Date().toISOString(),outcome:'offline'});return BackgroundTask.BackgroundTaskResult.Success;}
  const result=await backgroundSyncOnce(owner);
  await saveRun(owner,{attemptedAt,finishedAt:new Date().toISOString(),outcome:'synced',uploaded:result.uploaded,pending:result.pending,blocked:result.blocked});
  return BackgroundTask.BackgroundTaskResult.Success;
 }catch(error:any){
  const held=isSessionAccessError(error);
  await saveRun(owner,{attemptedAt,finishedAt:new Date().toISOString(),outcome:held?(error.code==='SESSION_CHANGED'?'account_changed':'locked'):'failed'}).catch(()=>undefined);
  return held?BackgroundTask.BackgroundTaskResult.Success:BackgroundTask.BackgroundTaskResult.Failed;
 }
}
export function runBusinessBackgroundSync(){
 if(running)return running;
 const job=run().finally(()=>{if(running===job)running=null;});running=job;return job;
}
TaskManager.defineTask(BACKGROUND_SYNC_TASK,({error})=>error?Promise.resolve(BackgroundTask.BackgroundTaskResult.Failed):runBusinessBackgroundSync());
// Cancel the old WorkRequest: its persisted CONNECTED constraint requires
// Android-validated Internet, even when the office server is reachable on LAN.
TaskManager.defineTask(PREVIOUS_BACKGROUND_SYNC_TASK,async()=>{
 await BackgroundTask.unregisterTaskAsync(PREVIOUS_BACKGROUND_SYNC_TASK).catch(()=>undefined);
 return BackgroundTask.BackgroundTaskResult.Success;
});
// Older optional releases used BackgroundFetch; retire their registration on upgrade.
TaskManager.defineTask(LEGACY_BACKGROUND_SYNC_TASK,async()=>{
 await BackgroundFetch.unregisterTaskAsync(LEGACY_BACKGROUND_SYNC_TASK).catch(()=>undefined);
 return BackgroundFetch.BackgroundFetchResult.NoData;
});
export async function registerBusinessBackgroundSync():Promise<boolean>{
 const version=epoch;
 if(!await TaskManager.isAvailableAsync())return false;
 if(await TaskManager.isTaskRegisteredAsync(PREVIOUS_BACKGROUND_SYNC_TASK))await BackgroundTask.unregisterTaskAsync(PREVIOUS_BACKGROUND_SYNC_TASK);
 if(await TaskManager.isTaskRegisteredAsync(LEGACY_BACKGROUND_SYNC_TASK))await BackgroundFetch.unregisterTaskAsync(LEGACY_BACKGROUND_SYNC_TASK);
 if(!await businessBackgroundSyncEnabled())return false;
 if(await BackgroundTask.getStatusAsync()!==BackgroundTask.BackgroundTaskStatus.Available)return false;
 await assertBusinessSession();
 if(!await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK))await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK,{minimumInterval:15});
 if(epoch!==version||!await businessBackgroundSyncEnabled()){
  await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);return false;
 }
 try{await assertBusinessSession();}catch{await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);return false;}
 return true;
}
export async function unregisterBusinessBackgroundSync(){
 epoch++;
 if(!await TaskManager.isAvailableAsync())return;
 if(await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK))await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
 if(await TaskManager.isTaskRegisteredAsync(PREVIOUS_BACKGROUND_SYNC_TASK))await BackgroundTask.unregisterTaskAsync(PREVIOUS_BACKGROUND_SYNC_TASK);
 if(await TaskManager.isTaskRegisteredAsync(LEGACY_BACKGROUND_SYNC_TASK))await BackgroundFetch.unregisterTaskAsync(LEGACY_BACKGROUND_SYNC_TASK);
}
export async function setBusinessBackgroundSyncEnabled(enabled:boolean){
 await SecureStore.setItemAsync(ENABLED,String(enabled));
 return enabled?registerBusinessBackgroundSync():(await unregisterBusinessBackgroundSync(),false);
}
export async function businessBackgroundSyncStatus(){
 const [enabled,available,owner]=await Promise.all([businessBackgroundSyncEnabled(),TaskManager.isAvailableAsync(),getMeta('dataOwner')]);
 const [registered,status,raw]=await Promise.all([available?TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK):Promise.resolve(false),available?BackgroundTask.getStatusAsync():Promise.resolve(null),owner?getMeta(`background.lastRun:${owner}`):Promise.resolve(null)]);
 let lastRun:BackgroundRun|null=null;try{lastRun=raw?JSON.parse(raw):null;}catch{/* A missing diagnostic must not stop synchronization. */}
 const lastSuccessAt=owner?await getMeta(`background.lastSuccess:${owner}`):null;
 return {enabled,registered,available:available&&status===BackgroundTask.BackgroundTaskStatus.Available,lastRun,lastSuccessAt};
}
