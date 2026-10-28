import {beforeEach,describe,expect,it,jest} from '@jest/globals';
const mockRows:any[]=[],mockStore=new Map<string,string>();
const mockPost=jest.fn<(...args:any[])=>Promise<any>>();
jest.mock('../src/api/client',()=>({getClient:async()=>({post:mockPost,get:async()=>{throw Error('offline');}})}));
jest.mock('../src/db/database',()=>({
 attendanceRows:async()=>mockRows,
 attendanceResult:async(id:string,status:string)=>{mockRows.find(r=>r.operationId===id).status=status;},
 getMeta:async(k:string)=>k==='dataOwner'?'org:user':mockStore.get(k),
 setMeta:async(k:string,v:string)=>{mockStore.set(k,v);},
}));
import {projectAttendance,syncAttendance} from '../src/utils/attendance-offline';
describe('durable attendance synchronization',()=>{
 beforeEach(()=>{mockRows.length=0;mockStore.clear();mockPost.mockReset();});
 const rows=()=>['in','break_out','break_in','out'].map((action,i)=>({operationId:'op'+i,status:'pending',payload:JSON.stringify({action,operationId:'op'+i,recordedAt:1700000000000+i*3600000,method:'qr'})}));
 it('shows all four local actions and a completed day offline',()=>{const p=projectAttendance({records:[],open:null},rows());expect(p.open).toBeNull();expect(p.records).toHaveLength(1);expect(p.records[0].breakOut).toBeTruthy();expect(p.records[0].breakIn).toBeTruthy();expect(p.records[0].checkOut).toBeTruthy();});
 it('does not duplicate already acknowledged punches in the snapshot',()=>{const r=rows();expect(projectAttendance({records:[{inOperationId:'op0',id:'server'}],open:{id:'server',schedule:{fourPunches:true}}},r).records).toHaveLength(1);});
 it('stops on disconnect and retries with unchanged payload before subsequent actions',async()=>{
 mockRows.push(...rows());mockPost.mockRejectedValueOnce(new Error('offline'));
 await syncAttendance();expect(mockPost).toHaveBeenCalledTimes(1);expect(mockRows[0].status).toBe('pending');
 const first=mockPost.mock.calls[0];mockPost.mockResolvedValue({data:{id:'record'}});await syncAttendance();expect(mockPost.mock.calls[1]).toEqual(first);expect(mockRows.every(r=>r.status==='synced')).toBe(true);
 });
 it('keeps rejected data visible and does not upload later punches out of order',async()=>{mockRows.push(...rows());mockPost.mockRejectedValue({response:{status:400,data:{message:'invalid'}}});await syncAttendance();expect(mockRows[0].status).toBe('rejected');await syncAttendance();expect(mockPost).toHaveBeenCalledTimes(1);});
});
