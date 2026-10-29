import {describe,it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {CurrencyCharts} from './currency-charts';
import {barGeometry,HBarChart} from '@/components/ui/charts';
import {activeNavigationHref} from '@/lib/navigation-match';
import {describeNotification} from '@/lib/notification-presentation';
import {OperationsOverview} from './operations-overview';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {api} from '@/lib/api';
vi.mock('@/lib/auth',()=>({useMe:()=>({data:{id:'test-user'}}),useCan:()=> (p:string)=> permissions.includes(p)}));
vi.mock('@/lib/api',()=>({api:vi.fn()}));
let permissions:string[]=[];
afterEach(()=>{cleanup();vi.clearAllMocks();permissions=[];});
describe('dashboard presentation safeguards',()=>{
 it('isolates currency scales and collector rows when changing selection',()=>{
  const data:any={debtByCurrency:{YER:1000000,SAR:100},collectorPerformanceToday:[{collectorId:'a',collectorName:'محصل الريال اليمني',currency:'YER',amount:10000},{collectorId:'b',collectorName:'محصل الريال السعودي',currency:'SAR',amount:100}]};
  render(<CurrencyCharts data={data}/>);expect(screen.getByText('محصل الريال السعودي')).toBeInTheDocument();expect(screen.queryByText('محصل الريال اليمني')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('عملة الرسوم'),{target:{value:'YER'}});expect(screen.getByText('محصل الريال اليمني')).toBeInTheDocument();expect(screen.queryByText('محصل الريال السعودي')).not.toBeInTheDocument();
 });
 it('renders zero at zero width and negative values left of a common zero axis',()=>{
  const zero=barGeometry([-50,0,100],0),negative=barGeometry([-50,0,100],-50),positive=barGeometry([-50,0,100],100);
  expect(zero.width).toBe(0);expect(negative.left+negative.width).toBeCloseTo(negative.zero);expect(positive.left).toBe(positive.zero);expect(positive.width).toBeCloseTo(negative.width*2);
  expect(barGeometry([0,0],0)).toEqual({zero:-0,left:0,width:0});
  const {container}=render(<HBarChart items={[{key:'zero',label:'صفر',value:0}]}/>);expect(container.querySelector('[style*="width: 0%"]')).toBeTruthy();
 });
 it('selects only the most specific accessible path at a segment boundary',()=>{
  const hrefs=['/hr','/hr/payroll','/hr/employees','/inventory','/inventory/barcodes'];
  expect(activeNavigationHref('/hr/payroll',hrefs)).toBe('/hr/payroll');expect(activeNavigationHref('/hr/employees/123',hrefs)).toBe('/hr/employees');expect(activeNavigationHref('/inventory-other',hrefs)).toBeUndefined();expect(activeNavigationHref('/inventory/barcodes/',hrefs)).toBe('/inventory/barcodes');
 });
 it('presents HR notifications and unknown kinds without exposing machine keys',()=>{
  const n=describeNotification({kind:'hr_request_decided',payload:{title:'تمت الموافقة على الإجازة',message:'راجع الطلب',href:'/hr/requests#request-1'}});expect(n.title).toBe('تمت الموافقة على الإجازة');expect(n.href).toContain('/hr/requests');
  expect(describeNotification({kind:'unfamiliar_kind'}).title).toBe('إشعار جديد');expect(describeNotification({kind:'promise_due',payload:{customerName:'عميل'}}).text).toContain('عميل');
 });
 it('does not query or render operational summaries without permission',()=>{
  const q=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={q}><OperationsOverview/></QueryClientProvider>);expect(api).not.toHaveBeenCalled();expect(screen.queryByText('حالة المخزون')).not.toBeInTheDocument();q.clear();
 });
 it('uses classification totals rather than a paginated recommendation array',async()=>{
  permissions=['inventory.read'];vi.mocked(api).mockResolvedValue({classificationSummary:[{type:'stockout_risk',count:321}],decisions:[{type:'stockout_risk'}],snapshot:{publishedAt:null}});
  const q=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={q}><OperationsOverview/></QueryClientProvider>);expect(await screen.findByText('321')).toBeInTheDocument();expect(api).toHaveBeenCalledTimes(1);expect(api).toHaveBeenCalledWith('/oracle-inventory/summary');expect(screen.queryByText('طلبات الموظفين')).not.toBeInTheDocument();q.clear();
 });
 it('shows a failed summary as an error rather than zero pending requests',async()=>{
  permissions=['hr.requests.review'];vi.mocked(api).mockRejectedValue(new Error('offline'));const q=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={q}><OperationsOverview/></QueryClientProvider>);expect(await screen.findByRole('alert')).toHaveTextContent('تعذر قراءة الملخص');expect(screen.queryByText('سلف بانتظار المراجعة:')).not.toBeInTheDocument();q.clear();
 });
});
