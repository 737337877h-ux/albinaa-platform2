'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Ruler } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Button, Card, Field, Input } from '@/components/ui/primitives';
import { Table, TD, THead, TRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtMoney } from '@/lib/format';

interface UnitRow {
  id: string;
  code: string;
  nameAr: string;
  weightKg: number | null;
  isActive: boolean;
  reservationsCount: number;
}

type UnitForm = { code: string; nameAr: string; weightKg: string };
const EMPTY: UnitForm = { code: '', nameAr: '', weightKg: '' };

export default function UnitsPage() {
  const can = useCan();
  const allowed = can('reservations.manage');
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UnitRow | null>(null);
  const [form, setForm] = useState<UnitForm>(EMPTY);

  const units = useQuery<UnitRow[]>({
    queryKey: ['reservation-units-admin'],
    queryFn: () => api('/reservations/units/all'),
    enabled: allowed,
  });
  const save = useMutation({
    mutationFn: () => api(editing ? `/reservations/units/${editing.id}` : '/reservations/units', {
      method: editing ? 'PATCH' : 'POST',
      body: JSON.stringify({
        code: form.code.trim(),
        nameAr: form.nameAr.trim(),
        weightKg: form.weightKg === '' ? null : Number(form.weightKg),
      }),
    }),
    onSuccess: async () => {
      toast(editing ? 'تم تحديث الوحدة' : 'تم إنشاء الوحدة', 'ok');
      setDialogOpen(false); setEditing(null); setForm(EMPTY);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reservation-units-admin'] }),
        queryClient.invalidateQueries({ queryKey: ['reservation-units'] }),
      ]);
    },
    onError: (error: Error) => toast(error.message, 'err'),
  });
  const toggle = useMutation({
    mutationFn: (row: UnitRow) => api(`/reservations/units/${row.id}`, {
      method: 'PATCH', body: JSON.stringify({ isActive: !row.isActive }),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reservation-units-admin'] }),
        queryClient.invalidateQueries({ queryKey: ['reservation-units'] }),
      ]);
    },
    onError: (error: Error) => toast(error.message, 'err'),
  });

  const openCreate = () => { setEditing(null); setForm(EMPTY); setDialogOpen(true); };
  const openEdit = (row: UnitRow) => {
    setEditing(row);
    setForm({ code: row.code, nameAr: row.nameAr, weightKg: row.weightKg == null ? '' : String(row.weightKg) });
    setDialogOpen(true);
  };
  const valid = form.code.trim().length > 0 && form.nameAr.trim().length > 0
    && (form.weightKg === '' || Number(form.weightKg) > 0);

  if (!allowed) return <Card><PermissionNotice message="لا تملك صلاحية إدارة وحدات الحجوزات" /></Card>;
  return <div className="space-y-5">
    <PageHeader title="وحدات حجوزات البضاعة" action={<Button onClick={openCreate}><Plus className="h-4 w-4" />إضافة وحدة</Button>} />
    <Card className="overflow-hidden">
      <DataState
        isLoading={units.isLoading} isError={units.isError} error={units.error}
        onRetry={() => units.refetch()} isFetching={units.isFetching}
        isEmpty={!units.data?.length} emptyTitle="لا توجد وحدات معرفة" skeletonClassName="h-52"
      >
        <Table>
          <THead cols={['الوحدة', 'الرمز', 'وزن الوحدة', 'الحجوزات المرتبطة', 'الحالة', 'الإجراءات']} />
          <tbody>{(units.data ?? []).map((row) => <TRow key={row.id}>
            <TD><span className="inline-flex items-center gap-2 font-semibold"><Ruler className="h-4 w-4 text-gold-500" />{row.nameAr}</span></TD>
            <TD><span dir="ltr" className="tnum">{row.code}</span></TD>
            <TD className="tnum">{row.weightKg == null ? 'غير موزونة' : `${fmtMoney(row.weightKg)} كجم`}</TD>
            <TD className="tnum">{row.reservationsCount}</TD>
            <TD><Badge tone={row.isActive ? 'pine' : 'neutral'}>{row.isActive ? 'نشطة' : 'موقوفة'}</Badge></TD>
            <TD><div className="flex gap-2">
              <Button variant="secondary" onClick={() => openEdit(row)}><Pencil className="h-4 w-4" />تعديل</Button>
              <Button variant="ghost" loading={toggle.isPending} onClick={() => toggle.mutate(row)}>{row.isActive ? 'إيقاف' : 'تفعيل'}</Button>
            </div></TD>
          </TRow>)}</tbody>
        </Table>
      </DataState>
    </Card>
    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? 'تعديل وحدة القياس' : 'إضافة وحدة قياس'}>
      <div className="space-y-4">
        <Field label="اسم الوحدة *"><Input value={form.nameAr} onChange={(e) => setForm((v) => ({ ...v, nameAr: e.target.value }))} placeholder="مثال: ربطة" /></Field>
        <Field label="الرمز *"><Input dir="ltr" value={form.code} onChange={(e) => setForm((v) => ({ ...v, code: e.target.value }))} placeholder="BUNDLE" /></Field>
        <Field label="وزن الوحدة بالكيلوجرام" hint="اتركه فارغًا للوحدات غير الموزونة"><Input type="number" min="0" step="any" value={form.weightKg} onChange={(e) => setForm((v) => ({ ...v, weightKg: e.target.value }))} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setDialogOpen(false)}>إلغاء</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>حفظ</Button></div>
      </div>
    </Dialog>
  </div>;
}
