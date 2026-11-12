import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import {StaffMessagePopup,StaffBroadcastButton} from './staff-messages';

const state=vi.hoisted(()=>({signedIn:true,allowed:true,api:vi.fn()}));
vi.mock('@/lib/auth',()=>({useMe:()=>({data:state.signedIn?{id:'u1'}:null}),useCan:()=>(p:string)=>state.allowed&&p==='notifications.broadcast'}));
vi.mock('@/lib/api',()=>({api:state.api}));
vi.mock('./ui/toast',()=>({toast:vi.fn()}));
function mount(node:React.ReactNode){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);return client;}
afterEach(()=>{cleanup();state.signedIn=true;state.allowed=true;vi.restoreAllMocks();state.api.mockReset();});

it('keeps the staff message visible until acknowledgement is saved',async()=>{
 let read=false;
 state.api.mockImplementation(async(path:string)=>{
  if(path.endsWith('/read')){read=true;return {};}
  return {items:read?[]:[{id:'n1',payload:{title:'تنبيه الإدارة',message:'يرجى مراجعة جدول العملاء'}}]};
 });
 const client=mount(<StaffMessagePopup/>);
 expect(await screen.findByText('يرجى مراجعة جدول العملاء')).toBeTruthy();
 fireEvent.click(screen.getByText('تم الاطلاع'));
 await waitFor(()=>expect(screen.queryByText('يرجى مراجعة جدول العملاء')).toBeNull());
 expect(state.api).toHaveBeenCalledWith('/notifications/n1/read',{method:'PATCH'});client.clear();
});
it('does not query or display a popup after logout',()=>{
 state.signedIn=false;const client=mount(<StaffMessagePopup/>);expect(state.api).not.toHaveBeenCalled();client.clear();
});
it('hides broadcast controls without permission',()=>{
 state.allowed=false;const client=mount(<StaffBroadcastButton/>);expect(screen.queryByText('رسالة جماعية للموظفين')).toBeNull();client.clear();
});
it('retries the same broadcast operation after an uncertain network failure',async()=>{
 const sent:any[]=[];
 state.api.mockImplementation(async(path:string,init:any)=>{
  if(path.endsWith('recipients'))return {count:2};
  sent.push(JSON.parse(init.body));if(sent.length===1)throw new Error('انقطع الاتصال');return {queued:2};
 });
 vi.spyOn(window,'confirm').mockReturnValue(true);
 const client=mount(<StaffBroadcastButton/>);
 fireEvent.click(screen.getByText('رسالة جماعية للموظفين'));
 await screen.findByText('جميع مستخدمي المنشأة النشطين: 2');
 fireEvent.change(screen.getByLabelText('عنوان الرسالة'),{target:{value:'مراجعة اليوم'}});
 fireEvent.change(screen.getByLabelText('نص الرسالة'),{target:{value:'يرجى متابعة العملاء اليوم'}});
 fireEvent.click(screen.getByText('إرسال للجميع'));
 fireEvent.click(await screen.findByText('إعادة المحاولة'));
 await waitFor(()=>expect(sent).toHaveLength(2));
 expect(sent[1]).toEqual(sent[0]);expect(sent[0].operationId).toBeTruthy();client.clear();
});
