import {beforeEach,expect,it,jest} from '@jest/globals';
const mockPost=jest.fn<any>();
jest.mock('react-native',()=>({Platform:{OS:'android'},AppState:{currentState:'active'}}));
jest.mock('expo-constants',()=>({__esModule:true,default:{expoConfig:{version:'test'},deviceName:'test-phone'}}));
jest.mock('../src/config/product',()=>({isOperationsApp:false}));
jest.mock('../src/utils/secure-storage',()=>({getCachedUser:jest.fn()}));
jest.mock('../src/api/client',()=>({getClient:async()=>({post:mockPost}),getClientForOwner:async()=>({post:mockPost})}));
jest.mock('../src/db/database',()=>({hasInventoryCatalogOffline:async()=>false,getMeta:async(key:string)=>key==='syncSectionVersions'?JSON.stringify({customers:'a'.repeat(64)}):null}));
import {fetchSync} from '../src/api/endpoints';
const response={data:{snapshot:'delta',schemaVersion:2,syncToken:'next',serverTime:'2026-11-17T00:00:00.000Z',syncSectionVersions:{customers:'a'.repeat(64)},references:{}}};
beforeEach(()=>{jest.clearAllMocks();mockPost.mockResolvedValue(response);});
it('sends committed section revisions and bounds the best-effort heartbeat',async()=>{
 expect(await fetchSync('previous','org:u')).toBe(response);
 expect(mockPost.mock.calls[0]).toEqual(['/mobile/collection-sync',{lastSyncToken:'previous',inventoryCatalogVersion:undefined,syncSectionVersions:{customers:'a'.repeat(64)}},{timeout:90000}]);
 expect(mockPost.mock.calls[1][0]).toBe('/mobile/heartbeat');expect(mockPost.mock.calls[1][2]).toEqual({timeout:3000});
});
it('retries only the read-only snapshot in legacy mode after a server rollback',async()=>{
 mockPost.mockRejectedValueOnce({response:{status:400,data:{message:['property syncSectionVersions should not exist']}}});
 await fetchSync('previous','org:u');
 expect(mockPost.mock.calls[1]).toEqual(['/mobile/collection-sync',{lastSyncToken:'previous',inventoryCatalogVersion:undefined},{timeout:90000}]);expect(mockPost).toHaveBeenCalledTimes(3);
});
it('does not replay a rejected request for unrelated validation errors',async()=>{
 const error={response:{status:400,data:{message:'invalid scope'}}};mockPost.mockRejectedValueOnce(error);
 await expect(fetchSync('previous','org:u')).rejects.toBe(error);expect(mockPost).toHaveBeenCalledTimes(1);
});
it.each(['<html>proxy response</html>',null,{...response.data,syncToken:undefined},{...response.data,references:null},{...response.data,collections:{}},{...response.data,snapshot:'full'}])('rejects malformed snapshots before heartbeat or local application',async data=>{
 mockPost.mockResolvedValueOnce({data});
 await expect(fetchSync('previous','org:u')).rejects.toThrow('غير مكتمل');
 expect(mockPost).toHaveBeenCalledTimes(1);
});
