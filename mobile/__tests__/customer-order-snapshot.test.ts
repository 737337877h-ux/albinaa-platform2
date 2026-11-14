import {beforeEach,expect,it,jest} from '@jest/globals';
const mockGet=jest.fn<any>(),mockReplace=jest.fn<any>(),mockSession=jest.fn<any>();let mockVersion:string|null='a'.repeat(64);
jest.mock('react-native',()=>({Platform:{OS:'android'},AppState:{currentState:'active'}}));
jest.mock('expo-constants',()=>({__esModule:true,default:{expoConfig:{version:'test'}}}));
jest.mock('../src/config/product',()=>({isOperationsApp:true}));
jest.mock('../src/utils/secure-storage',()=>({getCachedUser:jest.fn()}));
jest.mock('../src/api/client',()=>({getClient:async()=>({get:mockGet}),getClientForOwner:async()=>({get:mockGet})}));
jest.mock('../src/utils/business-session',()=>({assertBusinessSession:(...args:any[])=>mockSession(...args)}));
jest.mock('../src/db/database',()=>({getMeta:async()=>mockVersion,replaceCustomerOrdersSnapshot:(...args:any[])=>mockReplace(...args)}));
import {fetchCustomerOrdersOfflineSnapshot} from '../src/api/endpoints';
beforeEach(()=>{jest.clearAllMocks();mockVersion='a'.repeat(64);mockSession.mockResolvedValue({owner:'org:u'});});
it('keeps local orders when the server confirms the requested version is unchanged',async()=>{
 mockGet.mockResolvedValue({data:{snapshotVersion:mockVersion,unchanged:true}});await fetchCustomerOrdersOfflineSnapshot();expect(mockReplace).not.toHaveBeenCalled();expect(mockGet).toHaveBeenCalledWith('/sales-order-drafts/offline',{params:{snapshotVersion:mockVersion}});
});
it('stores changed full snapshots and their revision under the original owner',async()=>{
 const rows=[{id:'o',lines:[{amount:'446105.077'}]}],version='b'.repeat(64);mockGet.mockResolvedValue({data:{items:rows,snapshotVersion:version,unchanged:false}});await fetchCustomerOrdersOfflineSnapshot();expect(mockReplace).toHaveBeenCalledWith(rows,version,'org:u');
});
it('retains compatibility with older servers and refuses malformed unchanged or missing data',async()=>{
 mockGet.mockResolvedValueOnce({data:{items:[]}});await fetchCustomerOrdersOfflineSnapshot();expect(mockReplace).toHaveBeenCalledWith([],undefined,'org:u');mockReplace.mockClear();
 mockGet.mockResolvedValueOnce({data:{unchanged:true,snapshotVersion:'b'.repeat(64)}});await expect(fetchCustomerOrdersOfflineSnapshot()).rejects.toThrow('تأكيد');expect(mockReplace).not.toHaveBeenCalled();
 mockGet.mockResolvedValueOnce({data:{}});await expect(fetchCustomerOrdersOfflineSnapshot()).rejects.toThrow('غير مكتملة');expect(mockReplace).not.toHaveBeenCalled();
});
it('never saves a snapshot after the account changes during download',async()=>{
 mockGet.mockResolvedValue({data:{items:[],snapshotVersion:'b'.repeat(64)}});mockSession.mockResolvedValueOnce({owner:'org:u'}).mockRejectedValueOnce({code:'SESSION_CHANGED'});await expect(fetchCustomerOrdersOfflineSnapshot()).rejects.toMatchObject({code:'SESSION_CHANGED'});expect(mockReplace).not.toHaveBeenCalled();
});
