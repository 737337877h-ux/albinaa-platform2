import {cleanup,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import YearReadiness from './page';
const state=vi.hoisted(()=>({allowed:true,api:vi.fn()}));
vi.mock('@/lib/auth',()=>({useCan:()=>()=>state.allowed}));
vi.mock('@/lib/api',()=>({api:state.api}));
vi.mock('@/components/app-shell',()=>({PageHeader:({title}:any)=><h1>{title}</h1>}));
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><YearReadiness/></QueryClientProvider>);return client;}
afterEach(()=>{cleanup();state.api.mockReset();state.allowed=true;});
it('keeps source approval pending rather than presenting a year-switch action',async()=>{
 state.api.mockResolvedValue({currentSource:'IAS20261',currentSourceYear:2026,checkedAt:'2026-11-13T01:00:00Z',checks:[{id:'source',title:'اعتماد المصدر',status:'review',message:'المصدر الجديد غير معتمد'}]});
 const client=mount();await screen.findByText('المصدر الجديد غير معتمد');expect(screen.getByText('يلزم مراجعة')).toBeTruthy();expect(screen.queryByRole('button',{name:'تغيير المصدر'})).toBeNull();client.clear();
});
it('requires settings management before loading source information',()=>{state.allowed=false;const client=mount();expect(state.api).not.toHaveBeenCalled();client.clear();});
