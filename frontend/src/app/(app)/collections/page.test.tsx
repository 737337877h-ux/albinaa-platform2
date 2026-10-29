import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import CollectionsPage from './page';
const mocks=vi.hoisted(()=>({queries:[] as any[],params:'fromDate=2026-10-20&toDate=2026-10-26',refetch:vi.fn(),api:vi.fn().mockResolvedValue({items:[]})}));
vi.mock('next/navigation',()=>({useRouter:()=>({replace:vi.fn()}),useSearchParams:()=>new URLSearchParams(mocks.params)}));
vi.mock('@/lib/api',()=>({api:mocks.api,apiFileBlob:vi.fn()}));
vi.mock('@/lib/auth',()=>({useCan:()=>(permission:string)=>permission==='customers.read'}));
vi.mock('@/components/app-shell',()=>({PageHeader:({action}:any)=><header><h1>التحصيلات</h1>{action}</header>}));
vi.mock('@tanstack/react-query',()=>({
 useQuery:(options:any)=>{mocks.queries.push(options);return {data:options.queryKey[0]==='collections'?{page:1,totalPages:2,total:44,totalsByCurrency:{YER:6031810,SAR:200},items:[{
  id:'oracle-direct:7001',collectedAt:'2026-10-25T00:00:00+03:00',currencyCode:'YER',amount:123400,status:'approved',receiptNumber:'7001',referenceNumber:'7001',
  source:'oracle_direct_receipt',customer:{id:'customer',name:'العميل التجريبي الأول',externalCustomerCode:'90001'},collector:{user:{fullName:'المحصل الأول'}},method:{name:'سند قبض Oracle'},branch:null,
 }]}:undefined,isLoading:false,isError:false,isFetching:false,refetch:mocks.refetch};},
 useQueryClient:()=>({invalidateQueries:vi.fn()}),useMutation:()=>({mutate:vi.fn(),isPending:false}),
}));
afterEach(()=>{cleanup();mocks.queries.length=0;mocks.refetch.mockClear();mocks.api.mockClear();});
it('opens the requested period and shows its Oracle receipts and complete period count',async()=>{
 render(<CollectionsPage/>);
 expect(screen.getByLabelText('من تاريخ')).toHaveValue('2026-10-20');
 expect(screen.getByLabelText('إلى تاريخ')).toHaveValue('2026-10-26');
 expect(screen.getByText('العميل التجريبي الأول')).toBeTruthy();
 expect(screen.getByText('44 تحصيل · الصفحة 1 من 2')).toBeTruthy();
 const query=mocks.queries.find(q=>q.queryKey[0]==='collections');await query.queryFn();
 expect(mocks.api).toHaveBeenCalledWith('/collections?page=1&limit=25&fromDate=2026-10-20&toDate=2026-10-26',{cache:'no-store'});
});
it('refreshes the actual collection register, periodically and when returning to the page',()=>{
 render(<CollectionsPage/>);
 const query=mocks.queries.find(q=>q.queryKey[0]==='collections');
 expect(query.refetchInterval).toBe(30000);expect(query.refetchOnWindowFocus).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'تحديث السجل'}));expect(mocks.refetch).toHaveBeenCalledTimes(1);
});
