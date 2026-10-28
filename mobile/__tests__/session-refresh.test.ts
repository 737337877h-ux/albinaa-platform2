/// <reference types="jest" />
import axios, { AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { getClient, resetClient } from '../src/api/client';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from '../src/utils/secure-storage';

jest.mock('../src/config/api', () => ({getBaseUrl: async () => 'https://test.invalid/api', getBaseUrlCandidates: async () => [], pingServer: jest.fn(), activateRuntimeBaseUrl: jest.fn()}));
const deferred = () => {let resolve!: (v:any)=>void; let reject!: (e:any)=>void; const promise=new Promise<any>((a,b)=>{resolve=a;reject=b;});return {resolve,reject,promise};};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
let post: jest.SpyInstance;
beforeEach(async () => {
 await setTokens('old-access','old-refresh'); await resetClient();
 post=jest.spyOn(axios,'post');
 const c=await getClient();
 c.defaults.adapter=async config => {
  const response={data:{ok:true},status:200,statusText:'OK',headers:{},config};
  if(config.headers.Authorization==='Bearer new-access')return response;
  throw new AxiosError('Unauthorized','401',config,undefined,{...response,status:401});
 };
});
afterEach(()=>jest.restoreAllMocks());
test('concurrent unauthorized requests share one refresh and both finish',async()=>{
 const pending=deferred();post.mockReturnValue(pending.promise);
 const c=await getClient();const results=Promise.all([c.get('/one'),c.get('/two')]);
 await tick();expect(post).toHaveBeenCalledTimes(1);
 pending.resolve({data:{accessToken:'new-access',refreshToken:'new-refresh'}});
 expect((await results).map(r=>r.status)).toEqual([200,200]);
 expect(await getRefreshToken()).toBe('new-refresh');
});
test('network loss retains credentials and a later request recovers',async()=>{
 post.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({data:{accessToken:'new-access',refreshToken:'new-refresh'}});
 const c=await getClient();await expect(c.get('/one')).rejects.toThrow('Network Error');
 expect(await getRefreshToken()).toBe('old-refresh');
 expect((await c.get('/two')).status).toBe(200);
});
test('server failure retains credentials',async()=>{
 post.mockRejectedValue({response:{status:503}});
 await expect((await getClient()).get('/one')).rejects.toBeDefined();
 expect(await getRefreshToken()).toBe('old-refresh');
});
test('old failed refresh cannot clear a newly signed in account',async()=>{
 const pending=deferred();post.mockReturnValue(pending.promise);
 const result=(await getClient()).get('/one').catch(e=>e);await tick();
 await resetClient();await setTokens('other-access','other-refresh');
 pending.reject({response:{status:401}});await result;
 expect(await getRefreshToken()).toBe('other-refresh');
});
test('old successful refresh cannot overwrite a newly signed in account',async()=>{
 const pending=deferred();post.mockReturnValue(pending.promise);
 const result=(await getClient()).get('/one').catch(e=>e);await tick();
 await resetClient();await setTokens('other-access','other-refresh');
 pending.resolve({data:{accessToken:'new-access',refreshToken:'new-refresh'}});await result;
 expect(await getRefreshToken()).toBe('other-refresh');
});
test('an explicit expired/revoked session requires login, without reviving legacy tokens',async()=>{
 await SecureStore.setItemAsync('access_token','legacy');await SecureStore.setItemAsync('refresh_token','legacy');
 post.mockRejectedValue({response:{status:401}});
 await expect((await getClient()).get('/one')).rejects.toBeDefined();
 expect(await getAccessToken()).toBeNull();expect(await getRefreshToken()).toBeNull();
});
test('token storage writes one complete pair and leaves old pair on failure',async()=>{
 jest.spyOn(SecureStore,'setItemAsync').mockRejectedValueOnce(new Error('Storage unavailable'));
 await expect(setTokens('new-access','new-refresh')).rejects.toThrow('Storage unavailable');
 expect(await getAccessToken()).toBe('old-access');expect(await getRefreshToken()).toBe('old-refresh');
 await clearTokens();expect(await getRefreshToken()).toBeNull();
});
