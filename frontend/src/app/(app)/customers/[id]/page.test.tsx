import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CustomerPage from './page';

const { queries } = vi.hoisted(() => ({queries: [] as any[]}));
vi.mock('next/navigation',()=>({useParams:()=>({id:'customer-id'}),useSearchParams:()=>new URLSearchParams('tab=statement'),useRouter:()=>({replace:vi.fn(),push:vi.fn()})}));
vi.mock('@tanstack/react-query',()=>({
  useQuery:(options:any)=>{queries.push(options);return {data:undefined,isLoading:false,isError:false,isFetching:false,refetch:vi.fn()};},
  useQueryClient:()=>({invalidateQueries:vi.fn()}),useMutation:()=>({mutate:vi.fn(),isPending:false}),
}));
vi.mock('@/lib/auth',()=>({useCan:()=>()=>true}));
vi.mock('@/components/app-shell',()=>({PageHeader:()=> <h1>العميل</h1>}));
vi.mock('@/components/message-template-dialog',()=>({MessageTemplateDialog:()=>null}));
vi.mock('@/components/customer-form-dialog',()=>({CustomerFormDialog:()=>null}));
afterEach(()=>{cleanup();queries.length=0;});
const statementQuery=()=>queries.filter(q=>q.queryKey[0]==='statement').at(-1);

it('waits for both archive dates and blocks exports before requesting the archive',()=>{
  render(<CustomerPage/>);
  const source=screen.getByRole('option',{name:/أرشيف Oracle/}).closest('select')!;
  fireEvent.change(source,{target:{value:'oracle_archive'}});
  expect(screen.getByText('اختر فترة الكشف')).toBeTruthy();
  expect(screen.getByText(/حدد «من تاريخ» و«إلى تاريخ»/)).toBeTruthy();
  expect(statementQuery().enabled).toBe(false);
  expect(screen.getByRole('button',{name:/تنزيل PDF/})).toBeDisabled();
  expect(screen.getByRole('button',{name:/معاينة قبل الطباعة/})).toBeDisabled();
  expect(screen.queryByText('حدث خطأ غير متوقع. حاول مرة أخرى.')).toBeNull();
  fireEvent.change(screen.getByLabelText('من تاريخ'),{target:{value:'2026-10-01'}});
  expect(statementQuery().enabled).toBe(false);
  fireEvent.change(screen.getByLabelText('إلى تاريخ'),{target:{value:'2026-10-26'}});
  expect(statementQuery().enabled).toBe(true);
  expect(screen.getByRole('button',{name:/تنزيل PDF/})).not.toBeDisabled();
});
