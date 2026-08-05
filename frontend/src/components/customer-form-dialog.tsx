'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';

export interface EditableCustomer {
  id?: string;
  externalCustomerCode?: string | null;
  name?: string | null;
  tradeName?: string | null;
  phonePrimary?: string | null;
  phoneSecondary?: string | null;
  whatsapp?: string | null;
  region?: string | null;
  address?: string | null;
  branchId?: string | null;
  branch?: { id: string; name: string } | null;
  customerType?: string | null;
  notes?: string | null;
}

type FormState = {
  externalCustomerCode: string; name: string; tradeName: string;
  phonePrimary: string; phoneSecondary: string; whatsapp: string;
  region: string; address: string; branchId: string; customerType: string; notes: string;
};

const emptyForm = (type = 'customer'): FormState => ({
  externalCustomerCode: '', name: '', tradeName: '', phonePrimary: '', phoneSecondary: '',
  whatsapp: '', region: '', address: '', branchId: '', customerType: type, notes: '',
});

export function CustomerFormDialog({ open, onClose, customer, defaultCustomerType = 'customer', onSaved }: {
  open: boolean;
  onClose: () => void;
  customer?: EditableCustomer | null;
  defaultCustomerType?: string;
  onSaved: (customer: EditableCustomer & { id: string }) => void;
}) {
  const editing = !!customer?.id;
  const [form, setForm] = useState<FormState>(() => emptyForm(defaultCustomerType));
  const [error, setError] = useState('');
  const branches = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches', 'customer-form'],
    queryFn: () => api('/branches'),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(customer ? {
      externalCustomerCode: customer.externalCustomerCode ?? '',
      name: customer.name ?? '',
      tradeName: customer.tradeName ?? '',
      phonePrimary: customer.phonePrimary ?? '',
      phoneSecondary: customer.phoneSecondary ?? '',
      whatsapp: customer.whatsapp ?? '',
      region: customer.region ?? '',
      address: customer.address ?? '',
      branchId: customer.branchId ?? customer.branch?.id ?? '',
      customerType: customer.customerType ?? defaultCustomerType,
      notes: customer.notes ?? '',
    } : emptyForm(defaultCustomerType));
  }, [open, customer, defaultCustomerType]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim() || (!editing && !form.externalCustomerCode.trim())) {
        throw new Error('اسم العميل وكود الحساب مطلوبان');
      }
      const body = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim() || undefined]));
      if (editing) delete body.externalCustomerCode;
      return api<EditableCustomer & { id: string }>(editing ? `/customers/${customer!.id}` : '/customers', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: (saved) => { onSaved(saved); onClose(); },
    onError: (cause) => setError(cause instanceof ApiError || cause instanceof Error ? cause.message : 'تعذّر حفظ العميل'),
  });

  const set = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <Dialog open={open} onClose={onClose} title={editing ? 'تعديل بيانات الحساب' : 'إضافة حساب جديد'} className="sm:max-w-3xl">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="كود الحساب" hint={editing ? 'لا يتغير لأنه مفتاح الربط مع النظام المحاسبي' : undefined}>
          <Input dir="ltr" disabled={editing} value={form.externalCustomerCode} onChange={(e) => set('externalCustomerCode', e.target.value)} />
        </Field>
        <Field label="اسم الحساب"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="الاسم التجاري"><Input value={form.tradeName} onChange={(e) => set('tradeName', e.target.value)} /></Field>
        <Field label="نوع الحساب">
          <Select value={form.customerType} onChange={(e) => set('customerType', e.target.value)}>
            <option value="customer">عميل</option><option value="advance">سلفة على الغير</option>
          </Select>
        </Field>
        <Field label="الهاتف الأساسي"><Input dir="ltr" value={form.phonePrimary} onChange={(e) => set('phonePrimary', e.target.value)} /></Field>
        <Field label="الهاتف الآخر"><Input dir="ltr" value={form.phoneSecondary} onChange={(e) => set('phoneSecondary', e.target.value)} /></Field>
        <Field label="واتساب"><Input dir="ltr" value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></Field>
        <Field label="المنطقة"><Input value={form.region} onChange={(e) => set('region', e.target.value)} /></Field>
        <Field label="الفرع">
          <Select value={form.branchId} onChange={(e) => set('branchId', e.target.value)}>
            <option value="">بدون فرع</option>
            {(branches.data ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </Select>
        </Field>
        <Field label="العنوان"><Input value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="ملاحظات"><Textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
      </div>
      {error && <p className="mt-3 text-sm text-debt-600" role="alert">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>إلغاء</Button>
        <Button loading={save.isPending} onClick={() => save.mutate()}>{editing ? 'حفظ التعديلات' : 'إضافة الحساب'}</Button>
      </div>
    </Dialog>
  );
}
