import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import CustomersWithoutPhones from './page';
const state=vi.hoisted(()=>({allowed:true,exportable:false,api:vi.fn(),download:vi.fn()}));
vi.mock('@/lib/auth',()=>({useCan:()=>((p:string)=>p==='reports.export'?state.exportable:state.allowed)}));
vi.mock('@/lib/api',()=>({api:state.api,downloadApiFile:state.download}));
vi.mock('@/components/app-shell',()=>({PageHeader:({title}:any)=><h1>{title}</h1>}));
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><CustomersWithoutPhones/></QueryClientProvider>);return client;}
afterEach(()=>{cleanup();state.allowed=true;state.exportable=false;state.api.mockReset();state.download.mockReset();});
it('never loads customers without the read permission',()=>{state.allowed=false;const client=mount();expect(state.api).not.toHaveBeenCalled();expect(screen.getByText('لا تملك صلاحية عرض العملاء.')).toBeTruthy();client.clear();});
it('applies search and assignment to both the list and the all-results export',async()=>{
 state.exportable=true;state.api.mockResolvedValue({total:1,totalPages:1,collectors:[{id:'collector',name:'محصل'}],items:[{id:'c1',externalCustomerCode:'0001',accountNumber:'0011',name:'محمد أحمد',collectorName:'محصل',reason:'لا توجد أرقام مسجلة'}]});
 const client=mount();await screen.findByText('محمد أحمد');
 fireEvent.change(screen.getByLabelText('بحث العملاء'),{target:{value:'محمد'}});fireEvent.click(screen.getByText('بحث'));
 fireEvent.change(screen.getByLabelText('المحصل'),{target:{value:'collector'}});
 await waitFor(()=>expect(state.api.mock.calls.some(([path])=>new URL('http://local'+path).searchParams.get('collectorId')==='collector')).toBe(true));
 await waitFor(()=>expect(screen.getByText('Excel لكل النتائج المطابقة')).not.toBeDisabled());
 fireEvent.click(screen.getByText('Excel لكل النتائج المطابقة'));
 await waitFor(()=>expect(state.download).toHaveBeenCalled());
 const url=new URL('http://local'+state.download.mock.calls[0][0]);expect(url.pathname).toBe('/customers/without-phones.xlsx');expect(url.searchParams.get('search')).toBe('محمد');expect(url.searchParams.get('collectorId')).toBe('collector');client.clear();
});
