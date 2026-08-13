'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { Button, Card, Field, Input, Money } from '@/components/ui/primitives';
import { Table, THead, TRow, TD } from '@/components/ui/table';

interface DataQuality {
  missingPhone: number;
  pendingDuplicatePairs: number;
  multiCurrencyCustomers: number;
  suspiciousBalances: number;
  unclassifiedReservationUnits: number;
  recentImportReports: {
    id: string; fileName: string; importedAt: string; status: string; rowsTotal: number;
    customersNew: number; customersUpdated: number; errorsCount: number;
    duplicatePairsFlagged: number; requiresReview: boolean;
  }[];
}

interface DuplicateCustomerRef {
  id: string;
  externalCustomerCode: string | null;
  name: string;
  phonePrimary: string | null;
  whatsapp: string | null;
  balances: { currencyCode: string; accountingBalance: string | number }[];
  _count: { importedTxns: number; followups: number; promises: number; collections: number; reservations: number; tasks: number };
}

interface CustomerMerge {
  id: string;
  status: 'active' | 'reversed';
  mergedAt: string;
  reversibleUntil: string;
  master: { id: string; name: string; externalCustomerCode: string };
  source: { id: string; name: string; externalCustomerCode: string };
  creator: { fullName: string };
  reverser: { fullName: string } | null;
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
  const canMerge = can('duplicates.merge');
  const canLink = can('customers.write');
  const qc = useQueryClient();
  const [mergeChoice, setMergeChoice] = useState<{ pair: DuplicatePair; masterId: string } | null>(null);
  const [mergeConfirm, setMergeConfirm] = useState('');
  const [reverseChoice, setReverseChoice] = useState<CustomerMerge | null>(null);
  const [reverseConfirm, setReverseConfirm] = useState('');

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

  const merges = useQuery<CustomerMerge[]>({
    queryKey: ['customer-merges'],
    queryFn: () => api<CustomerMerge[]>('/customers/duplicates/merges'),
    enabled: canMerge,
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

  const linkMut = useMutation({
    mutationFn: async ({ pairId, primaryId, childId }: { pairId: string; primaryId: string; childId: string }) => {
      await api(`/customers/${primaryId}/account-group/children`, {
        method: 'POST',
        body: JSON.stringify({ childCustomerId: childId }),
      });
      try {
        await api(`/customers/duplicates/${pairId}`, {
          method: 'PATCH',
          body: JSON.stringify({ decision: 'rejected_intentional' }),
        });
        return true;
      } catch {
        return false;
      }
    },
    onSuccess: (reviewed) => {
      toast(
        reviewed
          ? 'تم ربط الحساب الفرعي مع إبقاء السجلين والحركات كما هي'
          : 'تم ربط الحساب، وبقي قرار التشابه بحاجة إلى مراجعة',
        'ok',
      );
      qc.invalidateQueries({ queryKey: ['data-quality-duplicates'] });
      qc.invalidateQueries({ queryKey: ['data-quality-summary'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const mergeMut = useMutation({
    mutationFn: ({ pairId, masterId }: { pairId: string; masterId: string }) =>
      api(`/customers/duplicates/${pairId}/merge`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ masterCustomerId: masterId, confirmText: 'دمج' }),
      }),
    onSuccess: () => {
      toast('تم دمج العميلين ويمكن التراجع خلال 24 ساعة', 'ok');
      setMergeChoice(null);
      setMergeConfirm('');
      qc.invalidateQueries({ queryKey: ['data-quality-duplicates'] });
      qc.invalidateQueries({ queryKey: ['data-quality-summary'] });
      qc.invalidateQueries({ queryKey: ['customer-merges'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const reverseMut = useMutation({
    mutationFn: (mergeId: string) =>
      api(`/customers/duplicates/merges/${mergeId}/reverse`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ confirmText: 'تراجع' }),
      }),
    onSuccess: () => {
      toast('تم التراجع وإعادة السجلات إلى العميل السابق', 'ok');
      setReverseChoice(null);
      setReverseConfirm('');
      qc.invalidateQueries({ queryKey: ['data-quality-duplicates'] });
      qc.invalidateQueries({ queryKey: ['data-quality-summary'] });
      qc.invalidateQueries({ queryKey: ['customer-merges'] });
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

      <Card className="overflow-hidden">
        <div className="border-b border-concrete-100 px-4 py-3 dark:border-white/10">
          <h2 className="font-semibold">تقرير جودة آخر ملفات الاستيراد</h2>
          <p className="text-xs text-concrete-500">يظهر تلقائيًا بعد كل استيراد، وأي ملف به أخطاء أو أزواج تشابه يبقى بحاجة إلى مراجعة بشرية.</p>
        </div>
        <Table><THead cols={['الملف', 'الصفوف', 'جديد', 'محدّث', 'أخطاء', 'أزواج تشابه', 'النتيجة']} /><tbody>{(summary.data?.recentImportReports ?? []).map((job) => <TRow key={job.id} hazard={job.requiresReview}>
          <TD><span className="font-semibold">{job.fileName}</span><p className="text-xs text-concrete-500">{new Date(job.importedAt).toLocaleString('ar-YE')}</p></TD>
          <TD className="tnum">{job.rowsTotal}</TD><TD className="tnum">{job.customersNew}</TD><TD className="tnum">{job.customersUpdated}</TD><TD className="tnum">{job.errorsCount}</TD><TD className="tnum">{job.duplicatePairsFlagged}</TD><TD>{job.requiresReview ? <span className="text-hazard-700 dark:text-hazard-400">يحتاج مراجعة</span> : <span className="text-pine-700 dark:text-pine-200">سليم</span>}</TD>
        </TRow>)}</tbody></Table>
      </Card>

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
                    <CustomerComparison customer={p.customerA} />
                  </TD>
                  <TD>
                    <CustomerComparison customer={p.customerB} />
                  </TD>
                  <TD className="max-w-[260px] text-xs text-concrete-600 dark:text-concrete-400">
                    {p.matchReason}
                  </TD>
                  <TD>
                    <div className="flex min-w-[170px] flex-col gap-2">
                      {canLink && (
                        <>
                          <Button
                            className="text-xs"
                            variant="secondary"
                            loading={linkMut.isPending}
                            onClick={() => linkMut.mutate({ pairId: p.id, primaryId: p.customerA.id, childId: p.customerB.id })}
                          >
                            ربط — الأول رئيسي
                          </Button>
                          <Button
                            className="text-xs"
                            variant="secondary"
                            loading={linkMut.isPending}
                            onClick={() => linkMut.mutate({ pairId: p.id, primaryId: p.customerB.id, childId: p.customerA.id })}
                          >
                            ربط — الثاني رئيسي
                          </Button>
                        </>
                      )}
                      {canMerge && (
                        <>
                          <Button className="text-xs" onClick={() => setMergeChoice({ pair: p, masterId: p.customerA.id })}>
                            دمج — الأول أساسي
                          </Button>
                          <Button className="text-xs" variant="secondary" onClick={() => setMergeChoice({ pair: p, masterId: p.customerB.id })}>
                            دمج — الثاني أساسي
                          </Button>
                        </>
                      )}
                      <Button
                        className="text-xs"
                        variant="ghost"
                        loading={reviewMut.isPending}
                        onClick={() => reviewMut.mutate(p.id)}
                      >
                        ليس تكرارًا
                      </Button>
                    </div>
                  </TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        </DataState>
      </Card>

      {canMerge && (
        <Card className="p-4">
          <h2 className="font-display text-sm font-semibold">عمليات الدمج الحديثة</h2>
          <p className="mt-1 text-xs text-concrete-500">يمكن التراجع خلال 24 ساعة ما لم يتغير الرصيد بعد الدمج.</p>
          <div className="mt-4 space-y-2">
            {(merges.data ?? []).length === 0 && <p className="text-sm text-concrete-500">لا توجد عمليات دمج.</p>}
            {(merges.data ?? []).map((merge) => {
              const reversible = merge.status === 'active' && new Date(merge.reversibleUntil).getTime() > Date.now();
              return (
                <div key={merge.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-concrete-100 p-3 dark:border-white/10">
                  <div>
                    <p className="text-sm"><strong>{merge.source.name}</strong> ← <strong>{merge.master.name}</strong></p>
                    <p className="mt-1 text-xs text-concrete-500">
                      بواسطة {merge.creator.fullName} · {new Date(merge.mergedAt).toLocaleString('ar-YE')}
                    </p>
                  </div>
                  {reversible ? (
                    <Button variant="danger" onClick={() => setReverseChoice(merge)}>تراجع</Button>
                  ) : (
                    <span className="text-xs text-concrete-500">{merge.status === 'reversed' ? 'تم التراجع' : 'انتهت المهلة'}</span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Dialog open={Boolean(mergeChoice)} onClose={() => { setMergeChoice(null); setMergeConfirm(''); }} title="تأكيد دمج العميلين">
        {mergeChoice && (
          <div className="space-y-4">
            <div className="rounded-lg bg-hazard-50 p-3 text-sm text-hazard-700 dark:bg-hazard-700/20 dark:text-hazard-100">
              سيبقى <strong>{mergeChoice.masterId === mergeChoice.pair.customerA.id ? mergeChoice.pair.customerA.name : mergeChoice.pair.customerB.name}</strong> كسجل أساسي،
              ويؤرشف السجل الآخر بعد نقل حركاته. لا تُخلط العملات، ويمكن التراجع خلال 24 ساعة.
            </div>
            <Field label='اكتب كلمة "دمج" للتأكيد'>
              <Input value={mergeConfirm} onChange={(e) => setMergeConfirm(e.target.value)} autoFocus />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setMergeChoice(null)}>إلغاء</Button>
              <Button
                variant="danger"
                loading={mergeMut.isPending}
                disabled={mergeConfirm !== 'دمج'}
                onClick={() => mergeMut.mutate({ pairId: mergeChoice.pair.id, masterId: mergeChoice.masterId })}
              >
                تنفيذ الدمج
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={Boolean(reverseChoice)} onClose={() => { setReverseChoice(null); setReverseConfirm(''); }} title="التراجع عن الدمج">
        {reverseChoice && (
          <div className="space-y-4">
            <p className="text-sm text-concrete-600 dark:text-concrete-300">
              ستُعاد السجلات المنقولة من <strong>{reverseChoice.master.name}</strong> إلى <strong>{reverseChoice.source.name}</strong>.
            </p>
            <Field label='اكتب كلمة "تراجع" للتأكيد'>
              <Input value={reverseConfirm} onChange={(e) => setReverseConfirm(e.target.value)} autoFocus />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setReverseChoice(null)}>إلغاء</Button>
              <Button
                variant="danger"
                loading={reverseMut.isPending}
                disabled={reverseConfirm !== 'تراجع'}
                onClick={() => reverseMut.mutate(reverseChoice.id)}
              >
                تنفيذ التراجع
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function CustomerComparison({ customer }: { customer: DuplicateCustomerRef }) {
  const activity = customer._count.importedTxns + customer._count.followups + customer._count.promises
    + customer._count.collections + customer._count.reservations + customer._count.tasks;
  return (
    <div className="min-w-[180px] space-y-1.5">
      <Link className="font-medium text-pine-700 hover:underline dark:text-pine-100" href={`/customers/${customer.id}`}>
        {customer.name}
      </Link>
      <p className="text-xs text-concrete-500" dir="ltr">{customer.externalCustomerCode ?? '—'}</p>
      {(customer.phonePrimary || customer.whatsapp) && (
        <p className="text-xs text-concrete-500" dir="ltr">{customer.phonePrimary ?? customer.whatsapp}</p>
      )}
      <div className="space-y-1">
        {customer.balances.map((balance) => (
          <div key={balance.currencyCode}><Money value={balance.accountingBalance} currency={balance.currencyCode} signed /></div>
        ))}
      </div>
      <p className="text-xs text-concrete-500">{activity} حركة ومتابعة مرتبطة</p>
    </div>
  );
}
