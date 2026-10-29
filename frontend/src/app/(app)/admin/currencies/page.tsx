'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Button, Card, Input, Field } from '@/components/ui/primitives';
import { Table, THead, TRow, TD } from '@/components/ui/table';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';

interface Currency {
  code: string;
  sourceCode: string;
  nameAr: string;
  decimals: number;
  exchangeRate: number | string;
  active: boolean;
}

interface EditForm {
  nameAr: string;
  sourceCode: string;
  decimals: string;
  exchangeRate: string;
  active: boolean;
}

export default function AdminCurrenciesPage() {
  const can = useCan();
  const canManage = can('settings.manage');
  const qc = useQueryClient();

  const [editTarget, setEditTarget] = useState<Currency | null>(null);
  const [form, setForm] = useState<EditForm>({ nameAr: '', sourceCode: '', decimals: '2', exchangeRate: '1', active: true });

  const query = useQuery<Currency[]>({
    queryKey: ['currencies'],
    queryFn: () => api<Currency[]>('/currencies'),
    enabled: canManage,
  });

  const mutation = useMutation({
    mutationFn: (data: { code: string; body: Partial<Record<string, unknown>> }) =>
      api(`/currencies/${data.code}`, {
        method: 'PATCH',
        body: JSON.stringify(data.body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['currencies'] });
      toast('تم حفظ التعديلات بنجاح');
      setEditTarget(null);
    },
    onError: (err) => {
      toast(err instanceof Error ? err.message : 'حدث خطأ أثناء الحفظ', 'err');
    },
  });

  const openEdit = (c: Currency) => {
    setForm({ nameAr: c.nameAr, sourceCode: c.sourceCode, decimals: String(c.decimals), exchangeRate: String(c.exchangeRate), active: c.active });
    setEditTarget(c);
  };

  const handleSave = () => {
    if (!editTarget) return;
    mutation.mutate({
      code: editTarget.code,
      body: {
        nameAr: form.nameAr,
        sourceCode: form.sourceCode,
        decimals: Number(form.decimals),
        exchangeRate: Number(form.exchangeRate),
        active: form.active,
      },
    });
  };

  if (!canManage) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية إدارة العملات" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="إدارة العملات" />
      <Card className="p-4 text-sm text-concrete-600 dark:text-concrete-300">
        سعر الصرف هو عدد وحدات العملة الأساسية المقابلة لوحدة واحدة من العملة. لا تجمع اللوحات عملات مختلفة تلقائيًا؛ تُعرض كل عملة مستقلة حتى تعتمد الإدارة الأسعار وتختار تقريرًا موحدًا.
      </Card>

      <Card>
        <DataState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
          isFetching={query.isFetching}
          isEmpty={!query.data?.length}
          emptyTitle="لا توجد عملات"
          skeletonClassName="h-32"
        >
          {query.data && (
            <Table>
              <THead cols={['العملة', 'الاسم العربي', 'كود المصدر', 'سعر الصرف', 'الخانات العشرية', 'الحالة', '']} />
              <tbody>
                {query.data.map((c) => (
                  <TRow key={c.code}>
                    <TD className="font-medium">{c.code}</TD>
                    <TD>{c.nameAr}</TD>
                    <TD className="font-mono text-concrete-500">{c.sourceCode}</TD>
                    <TD className="tnum">{Number(c.exchangeRate).toLocaleString('en-US', { maximumFractionDigits: 6 })}</TD>
                    <TD>{c.decimals}</TD>
                    <TD>
                      <Badge tone={c.active ? 'pine' : 'neutral'}>
                        {c.active ? 'نشط' : 'غير نشط'}
                      </Badge>
                    </TD>
                    <TD>
                      <Button variant="ghost" onClick={() => openEdit(c)} aria-label="تعديل">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Card>

      <Dialog open={!!editTarget} onClose={() => setEditTarget(null)} title={editTarget ? `تعديل ${editTarget.code}` : ''}>
        {editTarget && (
          <div className="space-y-4">
            <Field label="الاسم العربي">
              <Input value={form.nameAr} onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))} />
            </Field>
            <Field label="كود المصدر">
              <Input value={form.sourceCode} onChange={(e) => setForm((f) => ({ ...f, sourceCode: e.target.value }))} />
            </Field>
            <Field label="الخانات العشرية">
              <Input
                type="number"
                min={0}
                max={6}
                value={form.decimals}
                onChange={(e) => setForm((f) => ({ ...f, decimals: e.target.value }))}
              />
            </Field>
            <Field label="سعر الصرف إلى العملة الأساسية" hint="يجب أن يكون أكبر من صفر، ويُحدّث يدويًا من الإدارة">
              <Input
                type="number"
                min="0.000001"
                step="0.000001"
                value={form.exchangeRate}
                onChange={(e) => setForm((f) => ({ ...f, exchangeRate: e.target.value }))}
              />
            </Field>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="h-4 w-4 rounded border-concrete-300 text-pine-700 focus:ring-pine-500"
              />
              <span className="text-sm font-medium text-concrete-700 dark:text-concrete-200">نشط</span>
            </label>
            <div className="flex items-center gap-3 pt-2">
              <Button onClick={handleSave} loading={mutation.isPending}>حفظ</Button>
              <Button variant="secondary" onClick={() => setEditTarget(null)}>إلغاء</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
