'use client';

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
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
  geoLat?: number | string | null;
  geoLng?: number | string | null;
  branchId?: string | null;
  branch?: { id: string; name: string } | null;
  customerType?: string | null;
  notes?: string | null;
}

type FormState = {
  externalCustomerCode: string; name: string; tradeName: string;
  phonePrimary: string; phoneSecondary: string; whatsapp: string;
  region: string; address: string; geoLat: string; geoLng: string;
  branchId: string; customerType: string; notes: string;
};

const emptyForm = (type = 'customer'): FormState => ({
  externalCustomerCode: '', name: '', tradeName: '', phonePrimary: '', phoneSecondary: '',
  whatsapp: '', region: '', address: '', geoLat: '', geoLng: '', branchId: '', customerType: type, notes: '',
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
      geoLat: customer.geoLat == null ? '' : String(customer.geoLat),
      geoLng: customer.geoLng == null ? '' : String(customer.geoLng),
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
      const hasLat = form.geoLat.trim() !== '';
      const hasLng = form.geoLng.trim() !== '';
      if (hasLat !== hasLng) throw new Error('يجب إدخال خط العرض وخط الطول معًا');
      const latitude = hasLat ? Number(form.geoLat) : undefined;
      const longitude = hasLng ? Number(form.geoLng) : undefined;
      if ((latitude !== undefined && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
        || (longitude !== undefined && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
        throw new Error('إحداثيات الموقع غير صحيحة');
      }
      const body = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [key, value.trim() || undefined]),
      ) as Record<string, string | number | undefined>;
      body.geoLat = latitude;
      body.geoLng = longitude;
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
  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setError('تحديد الموقع غير مدعوم في هذا المتصفح'); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setForm((current) => ({
        ...current,
        geoLat: coords.latitude.toFixed(6),
        geoLng: coords.longitude.toFixed(6),
      })),
      () => setError('تعذر قراءة الموقع؛ تحقق من صلاحية الموقع في المتصفح'),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

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
        <Field label="خط العرض"><Input dir="ltr" inputMode="decimal" value={form.geoLat} onChange={(e) => set('geoLat', e.target.value)} placeholder="15.369400" /></Field>
        <Field label="خط الطول"><Input dir="ltr" inputMode="decimal" value={form.geoLng} onChange={(e) => set('geoLng', e.target.value)} placeholder="44.191000" /></Field>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={useCurrentLocation}><MapPin className="h-4 w-4" /> استخدام موقعي الحالي</Button>
          {form.geoLat && form.geoLng && <a className="text-sm text-pine-700 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${form.geoLat},${form.geoLng}`}>معاينة الموقع على الخريطة</a>}
        </div>
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
