import {cleanup,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import CollectorPerformance from './page';
const state=vi.hoisted(()=>({allowed:true,api:vi.fn()}));
vi.mock('@/lib/auth',()=>({useCan:()=>()=>state.allowed}));
vi.mock('@/lib/api',()=>({api:state.api,downloadApiFile:vi.fn()}));
vi.mock('@/components/app-shell',()=>({PageHeader:({title}:any)=><h1>{title}</h1>}));
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><CollectorPerformance/></QueryClientProvider>);return client;}
afterEach(()=>{cleanup();state.api.mockReset();state.allowed=true;});
it('displays source freshness, all four decimals, zero activity, and missing targets distinctly',async()=>{
 state.api.mockResolvedValue({from:'2026-11-01',to:'2026-11-12',scope:'team',generatedAt:'2026-11-12T09:00:00Z',oracleSnapshotAt:null,sources:{platform:1,oracleMirror:0},totals:[{currency:'YER',amount:'100.0001'}],rows:[{collectorId:'a',collectorNo:1,collectorName:'محصل',currency:'YER',amount:'100.0001',receipts:1,customers:1,sharePercent:'100.00',target:null,targetAttainment:null}],activity:[{collectorId:'b',collectorNo:2,collectorName:'محصل بلا تحصيل',active:true,followups:0,followedCustomers:0,assignedCustomers:0,promisesCreated:0,promisesDue:0,promisesFulfilled:0,promisesOverdue:0}]});
 const client=mount();await screen.findByText('محصل بلا تحصيل');expect(screen.getAllByText('100.0001').length).toBe(2);expect(screen.getByText('غير محدد')).toBeTruthy();expect(screen.getByText(/آخر لقطة حركات Oracle:/)).toHaveTextContent('غير متاحة');client.clear();
});
it('does not fetch when reporting access is denied',()=>{state.allowed=false;const client=mount();expect(state.api).not.toHaveBeenCalled();client.clear();});
