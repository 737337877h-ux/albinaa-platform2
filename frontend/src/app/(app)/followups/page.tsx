'use client';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Plus, Pencil, Trash2, PhoneCall } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, CCY_AR } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { Badge, Button, Card, Field, Input, Pagination, Select, Textarea } from '@/components/ui/primitives';
import { Table, TRow, TD } from '@/components/ui/table';

/* ────────────────────────────── Types ────────────────────────────────── */

interface FollowupItem {
  id: string;
  customerId: string;
  userId: string;
  typeId: string;
  resultId: string;
  followupAt: string;
  notes: string | null;
  nextFollowupDate: string | null;
  expectedAmount: number | null;
  expectedCurrency: string | null;
  type: { name: string };
  result: { name: string };
  user: { fullName: string };
  customer: { id: string; name: string; externalCustomerCode: string | null };
}

interface FollowupsResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: FollowupItem[];
}

interface NameId {
  id: string;
  name: string;
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

const todayISO = () => new Date().toISOString().slice(0, 10);

/* ────────────────────────────── Validation ────────────────────────────── */

const createSchema = z.object({
  customerId: z.string().uuid('اختر عميلًا'),
  typeId: z.string().uuid('اختر نوع المتابعة'),
  resultId: z.string().uuid('اختر نتيجة المتابعة'),
  followupAt: z.string().min(1, 'تاريخ المتابعة مطلوب'),
  notes: z.string().max(2000, 'الملاحظات لا تتجاوز 2000 حرف').optional(),
  nextFollowupDate: z.string().optional(),
  expectedAmount: z.string().optional(),
  expectedCurrency: z.string().max(3).optional(),
});

type CreateForm = z.infer<typeof createSchema>;

const editSchema = createSchema.omit({ customerId: true });
type EditForm = z.infer<typeof editSchema>;

/* ────────────────────────────── Main Page ────────────────────────────── */

export default function FollowupsPage() {
  const can = useCan();
  const canRead = can('customers.read');
  const canCreate = can('followups.create');
  const qc = useQueryClient();

  /* ──── Filter State ──── */
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 350);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [page, setPage] = useState(1);

  /* ──── Dialog State ──── */
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<FollowupItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<FollowupItem | null>(null);

  /* ──── Queries ──── */
  const query = useQuery<FollowupsResponse>({
    queryKey: ['followups', debouncedSearch, fromDate, toDate, typeFilter, resultFilter, page],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('page', String(page));
      p.set('limit', '25');
      if (fromDate) p.set('fromDate', fromDate);
      if (toDate) p.set('toDate', toDate);
      if (typeFilter) p.set('typeId', typeFilter);
      if (resultFilter) p.set('resultId', resultFilter);
      return api<FollowupsResponse>(`/followups?${p.toString()}`);
    },
    enabled: canRead,
  });

  const types = useQuery<NameId[]>({
    queryKey: ['followup-types'],
    queryFn: () => api<NameId[]>('/followups/types'),
    enabled: canRead,
  });

  const results = useQuery<NameId[]>({
    queryKey: ['followup-results'],
    queryFn: () => api<NameId[]>('/followups/results'),
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
          f.user.fullName.toLowerCase().includes(s) ||
          f.notes?.toLowerCase().includes(s)
        );
      })
    : items;

  /* ──── Mutations ──── */
  const createMut = useMutation({
    mutationFn: (data: CreateForm) => {
      const body: Record<string, unknown> = {
        customerId: data.customerId,
        typeId: data.typeId,
        resultId: data.resultId,
        followupAt: data.followupAt,
        notes: data.notes || undefined,
        nextFollowupDate: data.nextFollowupDate || undefined,
      };
      if (data.expectedAmount) {
        body.expectedAmount = Number(data.expectedAmount);
        body.expectedCurrency = data.expectedCurrency || undefined;
      }
      return api<FollowupItem>('/followups', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      toast('تم تسجيل المتابعة بنجاح', 'ok');
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ['followups'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const editMut = useMutation({
    mutationFn: ({ id, ...data }: EditForm & { id: string }) => {
      const body: Record<string, unknown> = {
        typeId: data.typeId,
        resultId: data.resultId,
        followupAt: data.followupAt,
        notes: data.notes || undefined,
        nextFollowupDate: data.nextFollowupDate || undefined,
      };
      if (data.expectedAmount) {
        body.expectedAmount = Number(data.expectedAmount);
        body.expectedCurrency = data.expectedCurrency || undefined;
      }
      return api<FollowupItem>(`/followups/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      toast('تم تعديل المتابعة بنجاح', 'ok');
      setEditItem(null);
      qc.invalidateQueries({ queryKey: ['followups'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/followups/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('تم حذف المتابعة بنجاح', 'ok');
      setDeleteItem(null);
      qc.invalidateQueries({ queryKey: ['followups'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  /* ──── Permission Gate ──── */
  if (!canRead) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية عرض المتابعات (customers.read)" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="المتابعات"
        action={canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            متابعة جديدة
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
              placeholder="بحث بالعميل، المحصل، أو الملاحظات…"
              aria-label="بحث في المتابعات"
            />
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">من تاريخ</span>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">إلى تاريخ</span>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => { setToDate(e.target.value); setPage(1); }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">النوع</span>
              <Select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
                <option value="">الكل</option>
                {types.data?.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
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
          emptyTitle="لا توجد متابعات"
          emptyHint={debouncedSearch || fromDate || toDate || typeFilter ? 'جرّب تغيير معايير البحث أو الفلاتر' : undefined}
          skeletonClassName="h-64"
        >
          <>
            <Table>
              <thead>
                <tr className="border-b border-concrete-100 text-right text-xs text-concrete-500 dark:border-white/10 dark:text-concrete-400">
                  <th className="px-4 py-2.5 font-medium">العميل</th>
                  <th className="px-4 py-2.5 font-medium">النوع</th>
                  <th className="px-4 py-2.5 font-medium">النتيجة</th>
                  <th className="px-4 py-2.5 font-medium">التاريخ</th>
                  <th className="px-4 py-2.5 font-medium">المحصل</th>
                  <th className="px-4 py-2.5 font-medium">الملاحظات</th>
                  <th className="px-4 py-2.5 font-medium">التالي</th>
                  {canCreate && <th className="px-4 py-2.5 font-medium">إجراءات</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <TRow key={f.id}>
                    <TD>
                      <Link
                        href={`/customers/${f.customer.id}`}
                        className="font-medium text-pine-700 hover:underline dark:text-pine-100"
                      >
                        {f.customer.name}
                      </Link>
                      {f.customer.externalCustomerCode && (
                        <p className="text-xs text-concrete-500" dir="ltr">{f.customer.externalCustomerCode}</p>
                      )}
                    </TD>
                    <TD>
                      <Badge tone="pine">{f.type.name}</Badge>
                    </TD>
                    <TD>
                      <Badge tone="hazard">{f.result.name}</Badge>
                    </TD>
                    <TD className="text-xs whitespace-nowrap">{fmtDateTime(f.followupAt)}</TD>
                    <TD className="text-sm">{f.user.fullName}</TD>
                    <TD className="max-w-[180px] truncate text-xs text-concrete-600 dark:text-concrete-400">
                      {f.notes ?? '—'}
                    </TD>
                    <TD className="text-xs whitespace-nowrap">
                      {f.nextFollowupDate ? fmtDate(f.nextFollowupDate) : '—'}
                    </TD>
                    {canCreate && (
                      <TD>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setEditItem(f)}
                            className="rounded p-1.5 text-concrete-400 hover:bg-concrete-100 hover:text-pine-700 dark:hover:bg-white/10 dark:hover:text-pine-100"
                            aria-label="تعديل المتابعة"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteItem(f)}
                            className="rounded p-1.5 text-concrete-400 hover:bg-debt-50 hover:text-debt-600 dark:hover:bg-debt-700/20 dark:hover:text-debt-400"
                            aria-label="حذف المتابعة"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TD>
                    )}
                  </TRow>
                ))}
              </tbody>
            </Table>
            <Pagination page={query.data?.page ?? 1} totalPages={query.data?.totalPages ?? 1} onPage={setPage} />
          </>
        </DataState>
      </Card>

      {/* ──── إجمالي النتائج ──── */}
      {query.data && (
        <p className="text-center text-xs text-concrete-400">
          إجمالي النتائج: {query.data.total} متابعة — الصفحة {query.data.page} من {query.data.totalPages}
        </p>
      )}

      {/* ──── إنشاء متابعة ──── */}
      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        types={types.data ?? []}
        results={results.data ?? []}
        onSubmit={(data) => createMut.mutate(data)}
        loading={createMut.isPending}
      />

      {/* ──── تعديل متابعة ──── */}
      <EditDialog
        item={editItem}
        onClose={() => setEditItem(null)}
        types={types.data ?? []}
        results={results.data ?? []}
        onSubmit={(data) => editMut.mutate({ ...data, id: editItem!.id })}
        loading={editMut.isPending}
      />

      {/* ──── حذف متابعة ──── */}
      <DeleteDialog
        item={deleteItem}
        onClose={() => setDeleteItem(null)}
        onConfirm={() => deleteMut.mutate(deleteItem!.id)}
        loading={deleteMut.isPending}
      />
    </div>
  );
}

/* ────────────────────────────── Create Dialog ────────────────────────── */

function CreateDialog({
  open, onClose, types, results, onSubmit, loading,
}: {
  open: boolean;
  onClose: () => void;
  types: NameId[];
  results: NameId[];
  onSubmit: (data: CreateForm) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { followupAt: new Date().toISOString().slice(0, 16) },
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
    setValue('customerId', c.id, { shouldValidate: true });
    setCustSearch('');
    setCustResults([]);
  };

  const expectedAmount = watch('expectedAmount');

  return (
    <Dialog open={open} onClose={onClose} title="تسجيل متابعة جديدة">
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
                onClick={() => { setSelectedCust(null); setValue('customerId', ''); }}
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
          <Field label="نوع المتابعة *" error={errors.typeId?.message}>
            <Select {...register('typeId')}>
              <option value="">اختر النوع…</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="النتيجة *" error={errors.resultId?.message}>
            <Select {...register('resultId')}>
              <option value="">اختر النتيجة…</option>
              {results.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="تاريخ المتابعة *" error={errors.followupAt?.message}>
          <Input type="datetime-local" {...register('followupAt')} />
        </Field>

        <Field label="موعد المتابعة القادمة" error={errors.nextFollowupDate?.message}>
          <Input type="date" {...register('nextFollowupDate')} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="المبلغ المتوقع" error={errors.expectedAmount?.message}>
            <Input type="number" step="0.01" min="0" placeholder="0.00" {...register('expectedAmount')} />
          </Field>
          {expectedAmount && expectedAmount !== '' && (
            <Field label="العملة" error={errors.expectedCurrency?.message}>
              <Select {...register('expectedCurrency')}>
                <option value="">اختر العملة…</option>
                {Object.entries(CCY_AR).map(([code, name]) => (
                  <option key={code} value={code}>{name} ({code})</option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <Field label="ملاحظات" error={errors.notes?.message}>
          <Textarea rows={3} placeholder="أضف ملاحظات…" {...register('notes')} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={loading}>
            <PhoneCall className="h-4 w-4" aria-hidden />
            تسجيل المتابعة
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ────────────────────────────── Edit Dialog ──────────────────────────── */

function EditDialog({
  item, onClose, types, results, onSubmit, loading,
}: {
  item: FollowupItem | null;
  onClose: () => void;
  types: NameId[];
  results: NameId[];
  onSubmit: (data: EditForm) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
  });

  useEffect(() => {
    if (item) {
      reset({
        typeId: item.typeId,
        resultId: item.resultId,
        followupAt: item.followupAt ? new Date(item.followupAt).toISOString().slice(0, 16) : '',
        notes: item.notes ?? '',
        nextFollowupDate: item.nextFollowupDate ? new Date(item.nextFollowupDate).toISOString().slice(0, 10) : '',
        expectedAmount: item.expectedAmount ? String(item.expectedAmount) : '',
        expectedCurrency: item.expectedCurrency ?? '',
      });
    }
  }, [item, reset]);

  const expectedAmount = watch('expectedAmount');

  return (
    <Dialog open={!!item} onClose={onClose} title={`تعديل متابعة — ${item?.customer.name ?? ''}`}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="نوع المتابعة" error={errors.typeId?.message}>
            <Select {...register('typeId')}>
              <option value="">اختر النوع…</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="النتيجة" error={errors.resultId?.message}>
            <Select {...register('resultId')}>
              <option value="">اختر النتيجة…</option>
              {results.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="تاريخ المتابعة" error={errors.followupAt?.message}>
          <Input type="datetime-local" {...register('followupAt')} />
        </Field>

        <Field label="موعد المتابعة القادمة" error={errors.nextFollowupDate?.message}>
          <Input type="date" {...register('nextFollowupDate')} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="المبلغ المتوقع" error={errors.expectedAmount?.message}>
            <Input type="number" step="0.01" min="0" placeholder="0.00" {...register('expectedAmount')} />
          </Field>
          {expectedAmount && expectedAmount !== '' && (
            <Field label="العملة" error={errors.expectedCurrency?.message}>
              <Select {...register('expectedCurrency')}>
                <option value="">اختر العملة…</option>
                {Object.entries(CCY_AR).map(([code, name]) => (
                  <option key={code} value={code}>{name} ({code})</option>
                ))}
              </Select>
            </Field>
          )}
        </div>

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

/* ────────────────────────────── Delete Dialog ────────────────────────── */

function DeleteDialog({
  item, onClose, onConfirm, loading,
}: {
  item: FollowupItem | null;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <Dialog open={!!item} onClose={onClose} title="حذف متابعة">
      <div className="space-y-4">
        <p className="text-sm text-concrete-600 dark:text-concrete-400">
          هل أنت متأكد من حذف هذه المتابعة؟
        </p>
        {item && (
          <div className="rounded-lg border border-concrete-100 bg-concrete-50 p-3 text-sm dark:border-white/10 dark:bg-iron-700">
            <p><span className="font-medium">العميل:</span> {item.customer.name}</p>
            <p><span className="font-medium">النوع:</span> {item.type.name}</p>
            <p><span className="font-medium">النتيجة:</span> {item.result.name}</p>
            <p><span className="font-medium">التاريخ:</span> {fmtDateTime(item.followupAt)}</p>
          </div>
        )}
        <p className="text-xs text-concrete-500">
          سيتم الحذف ناعمًا — السجل يبقى محفوظًا للتدقيق ولن يُحذف نهائيًا.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            <Trash2 className="h-4 w-4" aria-hidden />
            حذف
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
