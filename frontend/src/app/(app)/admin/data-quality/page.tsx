'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { toast } from '@/components/ui/toast';
import { Button, Card } from '@/components/ui/primitives';
import { Table, THead, TRow, TD } from '@/components/ui/table';

interface DataQuality {
  missingPhone: number;
  pendingDuplicatePairs: number;
  multiCurrencyCustomers: number;
  suspiciousBalances: number;
  unclassifiedReservationUnits: number;
}

interface DuplicateCustomerRef {
  id: string;
  externalCustomerCode: string | null;
  name: string;
  balances: { currencyCode: string; accountingBalance: string | number }[];
}

interface DuplicatePair {
  id: string;
  matchReason: string;
  reviewStatus: string;
  customerA: DuplicateCustomerRef;
  customerB: DuplicateCustomerRef;
}

// Read-only data quality overview. No merge/delete/edit here — review is a
// human decision only (reject as intentional), same as the existing endpoint.
export default function DataQualityPage() {
  const can = useCan();
  const canView = can('duplicates.review');
  const qc = useQueryClient();

  const summary = useQuery<DataQuality>({
    queryKey: ['data-quality-summary'],
    queryFn: () => api<DataQuality>('/customers/data-quality'),
    enabled: canView,
  });

  const duplicates = useQuery<DuplicatePair[]>({
    queryKey: ['data-quality-duplicates'],
    queryFn: () => api<DuplicatePair[]>('/customers/duplicates'),
    enabled: canView,
  });

  const reviewMut = useMutation({
    mutationFn: (pairId: string) =>
      api(`/customers/duplicates/${pairId}`, {
        method: 'PATCH',
        body: JSON.stringify({ decision: 'rejected_intentional' }),
      }),
    onSuccess: () => {
      toast('تم تسجيل المراجعة', 'ok');
      qc.invalidateQueries({ queryKey: ['data-quality-duplicates'] });
      qc.invalidateQueries({ queryKey: ['data-quality-summary'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  if (!canView) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية مراجعة جودة البيانات (duplicates.review)" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="جودة البيانات" />

      <DataState
        isLoading={summary.isLoading}
        isError={summary.isError}
        error={summary.error}
        onRetry={() => summary.refetch()}
        isFetching={summary.isFetching}
        isEmpty={false}
        emptyTitle=""
        skeletonClassName="h-28"
      >
        {summary.data && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Card className="p-4">
              <p className="text-xs text-concrete-500">عملاء بلا هاتف</p>
              <p className="tnum mt-1 font-display text-2xl font-bold">{summary.data.missingPhone}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-concrete-500">أزواج تشابه بانتظار المراجعة</p>
              <p className="tnum mt-1 font-display text-2xl font-bold">{summary.data.pendingDuplicatePairs}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-concrete-500">عملاء متعددو العملات</p>
              <p className="tnum mt-1 font-display text-2xl font-bold">{summary.data.multiCurrencyCustomers}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-concrete-500">أرصدة مشكوك فيها (مصرّح ≠ محاسبي)</p>
              <p className="tnum mt-1 font-display text-2xl font-bold">{summary.data.suspiciousBalances}</p>
            </Card>
            <Card className={summary.data.unclassifiedReservationUnits ? 'border-r-4 border-r-hazard-500 p-4' : 'p-4'}>
              <p className="text-xs text-concrete-500">وحدات حجوزات بانتظار التصنيف</p>
              <p className="tnum mt-1 font-display text-2xl font-bold">{summary.data.unclassifiedReservationUnits}</p>
            </Card>
          </div>
        )}
      </DataState>

      <Card>
        <DataState
          isLoading={duplicates.isLoading}
          isError={duplicates.isError}
          error={duplicates.error}
          onRetry={() => duplicates.refetch()}
          isFetching={duplicates.isFetching}
          isEmpty={!duplicates.data?.length}
          emptyTitle="لا حالات تشابه بانتظار المراجعة"
          skeletonClassName="h-48"
        >
          <Table>
            <THead cols={['العميل الأول', 'العميل الثاني', 'سبب التشابه', '']} />
            <tbody>
              {(duplicates.data ?? []).map((p) => (
                <TRow key={p.id}>
                  <TD>
                    <Link className="font-medium text-pine-700 hover:underline dark:text-pine-100" href={`/customers/${p.customerA.id}`}>
                      {p.customerA.name}
                    </Link>
                    {p.customerA.externalCustomerCode && (
                      <p className="text-xs text-concrete-500" dir="ltr">{p.customerA.externalCustomerCode}</p>
                    )}
                  </TD>
                  <TD>
                    <Link className="font-medium text-pine-700 hover:underline dark:text-pine-100" href={`/customers/${p.customerB.id}`}>
                      {p.customerB.name}
                    </Link>
                    {p.customerB.externalCustomerCode && (
                      <p className="text-xs text-concrete-500" dir="ltr">{p.customerB.externalCustomerCode}</p>
                    )}
                  </TD>
                  <TD className="max-w-[260px] text-xs text-concrete-600 dark:text-concrete-400">
                    {p.matchReason}
                  </TD>
                  <TD>
                    <Button
                      variant="secondary"
                      loading={reviewMut.isPending}
                      onClick={() => reviewMut.mutate(p.id)}
                    >
                      ليس تكرارًا
                    </Button>
                  </TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        </DataState>
      </Card>
    </div>
  );
}
