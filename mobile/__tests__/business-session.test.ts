import {afterEach,beforeEach,describe,expect,it,jest} from '@jest/globals';
import * as SecureStore from 'expo-secure-store';
import {assertBusinessSession,tokenSubject} from '../src/utils/business-session';
import {setTokens,setLastUserActivity,getLastUserActivity} from '../src/utils/secure-storage';
import {registerSessionWorkValidator,IDLE_TIMEOUT_MS} from '../src/utils/session-lock';
jest.mock('../src/db/database',()=>({getMeta:async()=> 'org:u1'}));
const token=(id:string)=>'header.'+Buffer.from(JSON.stringify({sub:id})).toString('base64url')+'.signature';
describe('headless business session boundary',()=>{
 let cleanup:(()=>void)|undefined;
 beforeEach(async()=>{await SecureStore.setItemAsync('albinaa.cached_user',JSON.stringify({id:'u1',organizationId:'org'}));await setTokens(token('u1'),'refresh');await setLastUserActivity(Date.now());});
 afterEach(()=>cleanup?.());
 it('uses the same recent identity without extending activity',async()=>{
  const last=await getLastUserActivity();expect((await assertBusinessSession('org:u1')).owner).toBe('org:u1');expect(await getLastUserActivity()).toBe(last);
 });
 it('holds pending work after fifteen minutes even when an access token remains',async()=>{
  await setLastUserActivity(Date.now()-IDLE_TIMEOUT_MS);
  await expect(assertBusinessSession()).rejects.toMatchObject({code:'SESSION_LOCKED'});
 });
 it('honors an explicit UI lock even while persisted activity is recent',async()=>{
  cleanup=registerSessionWorkValidator(()=>false);
  await expect(assertBusinessSession()).rejects.toMatchObject({code:'SESSION_LOCKED'});
 });
 it('cannot send old-account work with a newly signed in token',async()=>{
  await setTokens(token('u2'),'refresh');
  await expect(assertBusinessSession('org:u1')).rejects.toMatchObject({code:'SESSION_CHANGED'});
 });
 it('rejects a changed queue owner and malformed tokens',async()=>{
  await expect(assertBusinessSession('other:u1')).rejects.toMatchObject({code:'SESSION_CHANGED'});
  expect(tokenSubject('not-a-jwt')).toBeNull();
 });
});
