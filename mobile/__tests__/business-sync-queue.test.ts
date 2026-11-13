import {beforeEach,describe,expect,it,jest} from '@jest/globals';
const mockRequest=jest.fn<any>(),mockCheck=jest.fn<any>(),mockRemove=jest.fn<any>(),mockRetry=jest.fn<any>(),mockBlock=jest.fn<any>();
const mockRows=[{id:1,operationId:'stable-operation',type:'POST',endpoint:'/collections',payload:JSON.stringify({amount:100.125,customerId:'c1'})}];
jest.mock('../src/api/client',()=>({getClientForOwner:async()=>mockRequest}));
jest.mock('../src/api/endpoints',()=>({fetchSync:jest.fn(),uploadGps:jest.fn()}));
jest.mock('../src/utils/attendance-offline',()=>({syncAttendance:async()=>{}}));
jest.mock('../src/utils/local-notifications',()=>({rescheduleOfflineReminders:async()=>0}));
jest.mock('../src/utils/customer-order-sync',()=>({resolveCustomerOrderEndpoint:async(endpoint:string)=>endpoint}));
jest.mock('../src/utils/quotation-sync',()=>({submitQueuedQuotation:jest.fn()}));
jest.mock('../src/config/product',()=>({isOperationsApp:false}));
jest.mock('../src/utils/queue-lease',()=>({withQueueLease:async(work:any)=>work('org:u1',mockCheck)}));
jest.mock('../src/db/database',()=>({getPendingMutations:async()=>mockRows,removeMutation:(...args:any[])=>mockRemove(...args),incrementRetry:(...args:any[])=>mockRetry(...args),blockMutation:(...args:any[])=>mockBlock(...args),markOfflineRequestResult:async()=>{},saveGpsPoint:async()=>{}}));
import {processPendingMutationQueue} from '../src/utils/sync-operations';
describe('pending receipt queue across locks and failures',()=>{
 beforeEach(()=>{jest.clearAllMocks();mockCheck.mockResolvedValue(undefined);mockRequest.mockResolvedValue({data:{id:'final-receipt'}});});
 it('stops at a lock without deleting, blocking or incrementing an unsent operation',async()=>{
  mockCheck.mockResolvedValueOnce(undefined).mockRejectedValue({code:'SESSION_LOCKED'});
  expect(await processPendingMutationQueue('org:u1')).toBe(0);
  expect(mockRequest).not.toHaveBeenCalled();expect(mockRemove).not.toHaveBeenCalled();expect(mockRetry).not.toHaveBeenCalled();expect(mockBlock).not.toHaveBeenCalled();
 });
 it('retains the same operation key if the session locks after a committed response',async()=>{
  mockCheck.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce({code:'SESSION_LOCKED'});
  expect(await processPendingMutationQueue('org:u1')).toBe(0);expect(mockRemove).not.toHaveBeenCalled();
  mockCheck.mockResolvedValue(undefined);
  expect(await processPendingMutationQueue('org:u1')).toBe(1);
  expect(mockRequest.mock.calls[0]).toEqual(mockRequest.mock.calls[1]);expect((mockRequest.mock.calls[1][0] as any).headers['Idempotency-Key']).toBe('stable-operation');
 });
 it('keeps temporary server failures pending and retains permission failures for review',async()=>{
  mockRequest.mockRejectedValueOnce({response:{status:503,data:{message:'offline'}}});await processPendingMutationQueue('org:u1');
  expect(mockRetry).toHaveBeenCalledWith(1,'offline');expect(mockRemove).not.toHaveBeenCalled();
  mockRequest.mockRejectedValueOnce({response:{status:403,data:{message:'permission removed'}}});await processPendingMutationQueue('org:u1');
  expect(mockBlock).toHaveBeenCalledWith(1,'HTTP 403: permission removed');expect(mockRemove).not.toHaveBeenCalled();
 });
});
