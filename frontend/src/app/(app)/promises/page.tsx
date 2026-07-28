'use client';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Plus, Pencil, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDate, fmtMoney, CCY_AR, PROMISE_STATUS_AR } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { Badge, Button, Card, Field, Input, Pagination, Select, Textarea } from '@/components/ui/primitives';
import { Table, TRow, TD } from '@/components/ui/table';

/* ────────────────────────────── Types ────────────────────────────────── */

const PROMISE_STATUSES = [
  'upcoming', 'due_today', 'partially_fulfilled',
  'fulfilled', 'unfulfilled', 'cancelled_approved', 'postponed',
] as const;

type PromiseStatus = typeof PROMISE_STATUSES[number];

const OPEN_STATUSES: PromiseStatus[] = ['upcoming', 'due_today', 'partially_fulfilled'];

const FINAL_STATUSES: PromiseStatus[] = ['fulfilled', 'unfulfilled', 'cancelled_approved'];

interface PromiseItem {
  id: string;
  customerId: string;
  promiseDate: string;
  dueDate: string;
  expectedAmount: number;
  currencyCode: string;
  status: PromiseStatus;
  statusReason: string | null;
  fulfilledAmount: number | null;
  notes: string | null;
  customer: { id: string; name: string; externalCustomerCode: string | null };
  collector: { user: { fullName: string } } | null;
}

interface PromisesResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: PromiseItem[];
}

interface CustomerSearchItem {
  id: string;
  name: string;
  externalCustomerCode: string | null;
}

/* ────────────────────────────── Helpers ──────────────────────────────── */

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function statusTone(s: PromiseStatus) {
  if (s === 'fulfilled' || s === 'partially_fulfilled') return 'pine' as const;
  if (s === 'upcoming') return 'neutral' as const;
  if (s === 'due_today') return 'hazard' as const;
  if (s === 'unfulfilled') return 'debt' as const;
  if (s === 'postponed') return 'credit' as const;
  return 'neutral' as const;
}

const isEditable = (s: PromiseStatus) => !FINAL_STATUSES.includes(s);

const TARGET_STATUSES: { value: PromiseStatus; label: string }[] = [
  { value: 'fulfilled', label: 'منفذ' },
  { value: 'partially_fulfilled', label: 'منفذ جزئيًا' },
  { value: 'unfulfilled', label: 'غير منفذ' },
  { value: 'cancelled_approved', label: 'ملغى' },
  { value: 'postponed', label: 'مؤجل' },
];

/* ────────────────────────────── Validation ────────────────────────────── */

const createSchema = z.object({
  customerId: z.string().uuid('اختر عميلًا'),
  dueDate: z.string().min(1, 'تاريخ الاستحقاق مطلوب'),
  expectedAmount: z.string().min(1, 'المبلغ مطلوب').refine((v) => Number(v) > 0, 'المبلغ يجب أن يكون أكبر من صفر'),
  currencyCode: z.string().min(1, 'العملة مطلوبة'),
  notes: z.string().max(2000, 'الملاحظات لا تتجاوز 2000 حرف').optional(),
});
type CreateForm = z.infer<typeof createSchema>;

const editSchema = createSchema.omit({ customerId: true });
type EditForm = z.infer<typeof editSchema>;

const statusSchema = z.object({
  targetStatus: z.string().min(1, 'اختر الحالة'),
  reason: z.string().optional(),
  fulfilledAmount: z.string().optional(),
  newDueDate: z.string().optional(),
}).refine((data) => {
  if (data.targetStatus === 'unfulfilled' || data.targetStatus === 'cancelled_approved' || data.targetStatus === 'postponed') {
    return !!data.reason && data.reason.trim().length > 0;
  }
  return true;
}, { message: 'السبب مطلوب لهذه الحالة', path: ['reason'] })
  .refine((data) => {
    if (data.targetStatus === 'partially_fulfilled') {
      const n = Number(data.fulfilledAmount);
      return !isNaN(n) && n > 0;
    }
    return true;
  }, { message: 'المبلغ المدفوع مطلوب ويجب أن يكون أكبر من صفر', path: ['fulfilledAmount'] })
  .refine((data) => {
    if (data.targetStatus === 'postponed') {
      return !!data.newDueDate && data.newDueDate.length > 0;
    }
    return true;
  }, { message: 'الموعد الجديد مطلوب للتأجيل', path: ['newDueDate'] });
type StatusForm = z.infer<typeof statusSchema>;

/* ────────────────────────────── Main Page ────────────────────────────── */

export default function PromisesPage() {
  const can = useCan();
  const canRead = can('customers.read');
  const canCreate = can('promises.create');
  const qc = useQueryClient();

  /* ──── Filter State ──── */
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 350);
  const [statusFilter, setStatusFilter] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [page, setPage] = useState(1);

  /* ──── Dialog State ──── */
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<PromiseItem | null>(null);
  const [statusItem, setStatusItem] = useState<PromiseItem | null>(null);

  /* ──── Queries ──── */
  const query = useQuery<PromisesResponse>({
    queryKey: ['payment-promises', statusFilter, dueFrom, dueTo, page],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('page', String(page));
      p.set('limit', '25');
      if (statusFilter) p.set('status', statusFilter);
      if (dueFrom) p.set('dueFrom', dueFrom);
      if (dueTo) p.set('dueTo', dueTo);
      return api<PromisesResponse>(`/payment-promises?${p.toString()}`);
    },
    enabled: canRead,
  });

  /* ──── Client-side search ──── */
  const items = query.data?.items ?? [];
  const filtered = debouncedSearch
    ? items.filter((f) => {
        const s = debouncedSearch.toLowerCase();
        return (
          f.customer.name.toLowerCase().includes(s) ||
          f.customer.externalCustomerCode?.toLowerCase().includes(s) ||
          f.notes?.toLowerCase().includes(s)
        );
      })
    : items;

  /* ──── Mutations ──── */
  const createMut = useMutation({
    mutationFn: (data: CreateForm) => {
      const body: Record<string, unknown> = {
        customerId: data.customerId,
        dueDate: data.dueDate,
        expectedAmount: Number(data.expectedAmount),
        currencyCode: data.currencyCode,
        notes: data.notes || undefined,
      };
      return api<PromiseItem>('/payment-promises', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      toast('تم تسجيل الوعد بنجاح', 'ok');
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ['payment-promises'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const editMut = useMutation({
    mutationFn: ({ id, ...data }: EditForm & { id: string }) => {
      const body: Record<string, unknown> = {
        dueDate: data.dueDate,
        expectedAmount: Number(data.expectedAmount),
        currencyCode: data.currencyCode,
        notes: data.notes || undefined,
      };
      return api<PromiseItem>(`/payment-promises/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      toast('تم تعديل الوعد بنجاح', 'ok');
      setEditItem(null);
      qc.invalidateQueries({ queryKey: ['payment-promises'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, ...data }: StatusForm & { id: string; expectedAmount: number }) => {
      const body: Record<string, unknown> = {
        status: data.targetStatus,
      };
      if (data.reason) body.reason = data.reason;
      if (data.targetStatus === 'partially_fulfilled' && data.fulfilledAmount) {
        body.fulfilledAmount = Number(data.fulfilledAmount);
      }
      if (data.targetStatus === 'postponed' && data.newDueDate) {
        body.newDueDate = data.newDueDate;
      }
      return api<PromiseItem>(`/payment-promises/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      toast('تم تحديث الحالة بنجاح', 'ok');
      setStatusItem(null);
      qc.invalidateQueries({ queryKey: ['payment-promises'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  /* ──── Permission Gate ──── */
  if (!canRead) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية عرض وعود السداد (customers.read)" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="وعود السداد"
        action={canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            وعد جديد
          </Button>
        )}
      />

      <Card>
        {/* ──── شريط الفلاتر ──── */}
        <div className="border-b border-concrete-100 px-4 py-3 dark:border-white/10">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالعميل أو الكود…"
              aria-label="بحث في وعود السداد"
            />
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">الحالة</span>
              <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="">الكل</option>
                {Object.entries(PROMISE_STATUS_AR).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">من تاريخ الاستحقاق</span>
              <Input
                type="date"
                value={dueFrom}
                onChange={(e) => { setDueFrom(e.target.value); setPage(1); }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">إلى تاريخ الاستحقاق</span>
              <Input
                type="date"
                value={dueTo}
                onChange={(e) => { setDueTo(e.target.value); setPage(1); }}
              />
            </label>
          </div>
        </div>

        {/* ──── الجدول ──── */}
        <DataState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
          isFetching={query.isFetching}
          isEmpty={!filtered.length}
          emptyTitle="لا توجد وعود سداد"
          emptyHint={debouncedSearch || statusFilter || dueFrom || dueTo ? 'جرّب تغيير معايير البحث أو الفلاتر' : undefined}
          skeletonClassName="h-64"
        >
          <>
            <Table>
              <thead>
                <tr className="border-b border-concrete-100 text-right text-xs text-concrete-500 dark:border-white/10 dark:text-concrete-400">
                  <th className="px-4 py-2.5 font-medium">العميل</th>
                  <th className="px-4 py-2.5 font-medium">تاريخ الوعد</th>
                  <th className="px-4 py-2.5 font-medium">الاستحقاق</th>
                  <th className="px-4 py-2.5 font-medium">المبلغ</th>
                  <th className="px-4 py-2.5 font-medium">العملة</th>
                  <th className="px-4 py-2.5 font-medium">الحالة</th>
                  <th className="px-4 py-2.5 font-medium">المتبقي</th>
                  <th className="px-4 py-2.5 font-medium">المحصل</th>
                  <th className="px-4 py-2.5 font-medium">ملاحظات</th>
                  {canCreate && <th className="px-4 py-2.5 font-medium">إجراءات</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const remaining = p.expectedAmount - (p.fulfilledAmount ?? 0);
                  return (
                    <TRow key={p.id}>
                      <TD>
                        <Link
                          href={`/customers/${p.customer.id}`}
                          className="font-medium text-pine-700 hover:underline dark:text-pine-100"
                        >
                          {p.customer.name}
                        </Link>
                        {p.customer.externalCustomerCode && (
                          <p className="text-xs text-concrete-500" dir="ltr">{p.customer.externalCustomerCode}</p>
                        )}
                      </TD>
                      <TD className="text-xs whitespace-nowrap">{fmtDate(p.promiseDate)}</TD>
                      <TD className="text-xs whitespace-nowrap">{fmtDate(p.dueDate)}</TD>
                      <TD className="tnum text-sm">{fmtMoney(p.expectedAmount)}</TD>
                      <TD className="text-xs">{CCY_AR[p.currencyCode] ?? p.currencyCode}</TD>
                      <TD>
                        <Badge tone={statusTone(p.status)}>
                          {PROMISE_STATUS_AR[p.status] ?? p.status}
                        </Badge>
                      </TD>
                      <TD className="tnum text-sm">{fmtMoney(remaining > 0 ? remaining : 0)}</TD>
                      <TD className="text-sm">{p.collector?.user?.fullName ?? '—'}</TD>
                      <TD className="max-w-[160px] truncate text-xs text-concrete-600 dark:text-concrete-400">
                        {p.notes ?? '—'}
                      </TD>
                      {canCreate && (
                        <TD>
                          <div className="flex items-center gap-1">
                            {isEditable(p.status) && (
                              <button
                                onClick={() => setEditItem(p)}
                                className="rounded p-1.5 text-concrete-400 hover:bg-concrete-100 hover:text-pine-700 dark:hover:bg-white/10 dark:hover:text-pine-100"
                                aria-label="تعديل الوعد"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {isEditable(p.status) && (
                              <button
                                onClick={() => setStatusItem(p)}
                                className="rounded p-1.5 text-concrete-400 hover:bg-concrete-100 hover:text-hazard-700 dark:hover:bg-white/10 dark:hover:text-hazard-100"
                                aria-label="تحديث الحالة"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </TD>
                      )}
                    </TRow>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={query.data?.page ?? 1} totalPages={query.data?.totalPages ?? 1} onPage={setPage} />
          </>
        </DataState>
      </Card>

      {/* ──── إجمالي النتائج ──── */}
      {query.data && (
        <p className="text-center text-xs text-concrete-400">
          إجمالي النتائج: {query.data.total} وعد — الصفحة {query.data.page} من {query.data.totalPages}
        </p>
      )}

      {/* ──── إنشاء وعدين ──── */}
      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(data) => createMut.mutate(data)}
        loading={createMut.isPending}
      />

      {/* ──── تعديل وعدين ──── */}
      <EditDialog
        item={editItem}
        onClose={() => setEditItem(null)}
        onSubmit={(data) => editMut.mutate({ ...data, id: editItem!.id })}
        loading={editMut.isPending}
      />

      {/* ──── تحديث الحالة ──── */}
      <StatusDialog
        item={statusItem}
        onClose={() => setStatusItem(null)}
        onSubmit={(data) => statusMut.mutate({ ...data, id: statusItem!.id, expectedAmount: statusItem!.expectedAmount })}
        loading={statusMut.isPending}
      />
    </div>
  );
}

/* ────────────────────────────── Create Dialog ────────────────────────── */

function CreateDialog({
  open, onClose, onSubmit, loading,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CreateForm) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { currencyCode: 'YER' },
  });

  const [custSearch, setCustSearch] = useState('');
  const [custResults, setCustResults] = useState<CustomerSearchItem[]>([]);
  const [selectedCust, setSelectedCust] = useState<CustomerSearchItem | null>(null);
  const [custSearching, setCustSearching] = useState(false);
  const debouncedCust = useDebounced(custSearch, 300);

  useEffect(() => {
    if (!open) {
      reset();
      setCustSearch('');
      setCustResults([]);
      setSelectedCust(null);
    }
  }, [open, reset]);

  useEffect(() => {
    if (!debouncedCust || debouncedCust.length < 2) {
      setCustResults([]);
      return;
    }
    let cancelled = false;
    setCustSearching(true);
    api<{ items: CustomerSearchItem[] }>(`/customers?search=${encodeURIComponent(debouncedCust)}&limit=10`)
      .then((res) => { if (!cancelled) setCustResults(res.items); })
      .catch(() => { if (!cancelled) setCustResults([]); })
      .finally(() => { if (!cancelled) setCustSearching(false); });
    return () => { cancelled = true; };
  }, [debouncedCust]);

  const selectCustomer = (c: CustomerSearchItem) => {
    setSelectedCust(c);
    reset((prev) => ({ ...prev, customerId: c.id }));
    setCustSearch('');
    setCustResults([]);
  };

  return (
    <Dialog open={open} onClose={onClose} title="تسجيل وعد سداد جديد">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* اختيار العميل */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-concrete-700 dark:text-concrete-200">العميل *</label>
          {selectedCust ? (
            <div className="flex items-center justify-between rounded-lg border border-concrete-200 bg-concrete-50 px-3 py-2 dark:border-white/10 dark:bg-iron-700">
              <div>
                <span className="text-sm font-medium">{selectedCust.name}</span>
                {selectedCust.externalCustomerCode && (
                  <span className="mr-2 text-xs text-concrete-500" dir="ltr">{selectedCust.externalCustomerCode}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setSelectedCust(null); reset((prev) => ({ ...prev, customerId: '' })); }}
                className="text-xs text-debt-600 hover:underline"
              >
                تغيير
              </button>
            </div>
          ) : (
            <>
              <Input
                value={custSearch}
                onChange={(e) => setCustSearch(e.target.value)}
                placeholder="ابحث عن العميل بالاسم أو الكود…"
              />
              {custSearching && <p className="text-xs text-concrete-400">جارٍ البحث…</p>}
              {custResults.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-concrete-200 bg-white dark:border-white/10 dark:bg-iron-800">
                  {custResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="w-full px-3 py-2 text-right text-sm hover:bg-pine-50 dark:hover:bg-white/5"
                    >
                      <span className="font-medium">{c.name}</span>
                      {c.externalCustomerCode && (
                        <span className="mr-2 text-xs text-concrete-500" dir="ltr">{c.externalCustomerCode}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <input type="hidden" {...register('customerId')} />
          {errors.customerId && (
            <p className="text-xs text-debt-600 dark:text-debt-500">{errors.customerId.message}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="تاريخ الاستحقاق *" error={errors.dueDate?.message}>
            <Input type="date" {...register('dueDate')} />
          </Field>
          <Field label="العملة *" error={errors.currencyCode?.message}>
            <Select {...register('currencyCode')}>
              <option value="">اختر العملة…</option>
              {Object.entries(CCY_AR).map(([code, name]) => (
                <option key={code} value={code}>{name} ({code})</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="المبلغ المتوقع *" error={errors.expectedAmount?.message}>
          <Input type="number" step="0.01" min="0.01" placeholder="0.00" {...register('expectedAmount')} />
        </Field>

        <Field label="ملاحظات" error={errors.notes?.message}>
          <Textarea rows={3} placeholder="أضف ملاحظات…" {...register('notes')} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={loading}>تسجيل الوعد</Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ────────────────────────────── Edit Dialog ──────────────────────────── */

function EditDialog({
  item, onClose, onSubmit, loading,
}: {
  item: PromiseItem | null;
  onClose: () => void;
  onSubmit: (data: EditForm) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
  });

  useEffect(() => {
    if (item) {
      reset({
        dueDate: item.dueDate ? new Date(item.dueDate).toISOString().slice(0, 10) : '',
        expectedAmount: String(item.expectedAmount),
        currencyCode: item.currencyCode,
        notes: item.notes ?? '',
      });
    }
  }, [item, reset]);

  return (
    <Dialog open={!!item} onClose={onClose} title={`تعديل وعدين — ${item?.customer.name ?? ''}`}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="تاريخ الاستحقاق" error={errors.dueDate?.message}>
            <Input type="date" {...register('dueDate')} />
          </Field>
          <Field label="العملة" error={errors.currencyCode?.message}>
            <Select {...register('currencyCode')}>
              <option value="">اختر العملة…</option>
              {Object.entries(CCY_AR).map(([code, name]) => (
                <option key={code} value={code}>{name} ({code})</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="المبلغ المتوقع" error={errors.expectedAmount?.message}>
          <Input type="number" step="0.01" min="0.01" placeholder="0.00" {...register('expectedAmount')} />
        </Field>

        <Field label="ملاحظات" error={errors.notes?.message}>
          <Textarea rows={3} placeholder="أضف ملاحظات…" {...register('notes')} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={loading}>حفظ التعديلات</Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ────────────────────────────── Status Dialog ────────────────────────── */

function StatusDialog({
  item, onClose, onSubmit, loading,
}: {
  item: PromiseItem | null;
  onClose: () => void;
  onSubmit: (data: StatusForm) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<StatusForm>({
    resolver: zodResolver(statusSchema),
    defaultValues: { targetStatus: '', reason: '', fulfilledAmount: '', newDueDate: '' },
  });

  const targetStatus = watch('targetStatus');

  useEffect(() => {
    if (item) {
      reset({ targetStatus: '', reason: '', fulfilledAmount: '', newDueDate: '' });
    }
  }, [item, reset]);

  const showReason = targetStatus === 'unfulfilled' || targetStatus === 'cancelled_approved' || targetStatus === 'postponed';
  const showFulfilledAmount = targetStatus === 'partially_fulfilled';
  const showNewDueDate = targetStatus === 'postponed';
  const remaining = item ? item.expectedAmount - (item.fulfilledAmount ?? 0) : 0;

  const availableTargets = TARGET_STATUSES.filter((t) => t.value !== item?.status);

  return (
    <Dialog open={!!item} onClose={onClose} title={`تحديث حالة الوعد — ${item?.customer.name ?? ''}`}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {item && (
          <div className="rounded-lg border border-concrete-100 bg-concrete-50 p-3 text-sm dark:border-white/10 dark:bg-iron-700">
            <p><span className="font-medium">العميل:</span> {item.customer.name}</p>
            <p><span className="font-medium">المبلغ:</span> {fmtMoney(item.expectedAmount)} {item.currencyCode}</p>
            <p><span className="font-medium">الحالية:</span> {PROMISE_STATUS_AR[item.status] ?? item.status}</p>
            {item.fulfilledAmount != null && item.fulfilledAmount > 0 && (
              <p><span className="font-medium">المدفوع:</span> {fmtMoney(item.fulfilledAmount)} — المتبقي: {fmtMoney(remaining)}</p>
            )}
          </div>
        )}

        <Field label="الحالة الجديدة *" error={errors.targetStatus?.message}>
          <Select {...register('targetStatus')}>
            <option value="">اختر الحالة…</option>
            {availableTargets.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </Field>

        {showReason && (
          <Field label="السبب *" error={errors.reason?.message}>
            <Textarea
              rows={3}
              placeholder={
                targetStatus === 'unfulfilled' ? 'سبب عدم التنفيذ…' :
                targetStatus === 'cancelled_approved' ? 'سبب الإلغاء…' :
                'سبب التأجيل…'
              }
              {...register('reason')}
            />
          </Field>
        )}

        {showFulfilledAmount && (
          <Field
            label={`المبلغ المدفوع * (المتبقي: ${fmtMoney(remaining)})`}
            error={errors.fulfilledAmount?.message}
          >
            <Input
              type="number"
              step="0.01"
              min="0.01"
              max={remaining - 0.01}
              placeholder="0.00"
              {...register('fulfilledAmount')}
            />
          </Field>
        )}

        {showNewDueDate && (
          <Field label="الموعد الجديد *" error={errors.newDueDate?.message}>
            <Input type="date" {...register('newDueDate')} />
          </Field>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={loading}>تحديث الحالة</Button>
        </div>
      </form>
    </Dialog>
  );
}
