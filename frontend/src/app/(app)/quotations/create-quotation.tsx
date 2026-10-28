'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Input, Select, Textarea } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { createRequestId } from '@/lib/request-id';

type Line = { itemCode: string; unitCode: string; quantity: string; price: string; discount: string };
type Payload = { externalReference: string; customerCode: string; currencyCode: string; warehouseCode: string; notes: string; lines: Line[] };
type Item = { code: string; name: string; units: { code: string }[] };
type Preview = { gross: string; discount: string; net: string };

export function CreateQuotation({ scope, onSaved }: { scope: string; onSaved: () => void }) {
  const storageKey = `albinaa.quotation.pending:${scope}`;
  const [customerCode, setCustomer] = useState('');
  const [currencyCode, setCurrency] = useState('SR');
  const [warehouseCode, setWarehouse] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState<Payload | null>(null);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) setPending(JSON.parse(stored));
      setReference(createRequestId());
    } catch { setError('تعذر استعادة الطلب؛ تحقق من إعدادات تخزين المتصفح قبل الحفظ'); }
  }, [storageKey]);
  const customers = useQuery({ queryKey: ['quotation-customers', customerSearch], queryFn: () => api<{ externalCustomerCode: string; nameAr: string }[]>(`/sales-order-drafts/catalog/customers?search=${encodeURIComponent(customerSearch)}`) });
  const warehouses = useQuery({ queryKey: ['quotation-warehouses'], queryFn: () => api<{ externalWarehouseCode: string; nameAr: string }[]>('/sales-order-drafts/catalog/warehouses') });
  const items = useQuery({ queryKey: ['quotation-items', itemSearch], enabled: itemSearch.trim().length >= 2, queryFn: () => api<Item[]>(`/sales-order-drafts/catalog/items?search=${encodeURIComponent(itemSearch)}`) });
  const payload: Payload = { externalReference: reference, customerCode, currencyCode, warehouseCode, notes, lines };
  const changeLine = (index: number, field: keyof Line, value: string) => setLines(lines.map((line, i) => i === index ? { ...line, [field]: value } : line));
  async function validate() {
    setBusy(true); setError(''); setPreview(null);
    try { const result = await api<{ totals: Preview }>('/quotations/dry-run', { method: 'POST', body: JSON.stringify(payload) }); setPreview(result.totals); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذرت المعاينة'); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError('');
    try {
      const request = pending || payload;
      // Keep the same reference and exact payload after timeouts and page reloads.
      sessionStorage.setItem(storageKey, JSON.stringify(request)); setPending(request);
      const result = await api<{ number: string }>('/quotations', { method: 'POST', body: JSON.stringify(request) });
      sessionStorage.removeItem(storageKey); setPending(null); setPreview(null); setLines([]);
      setReference(createRequestId()); setSuccess(`تم حفظ عرض السعر رقم ${result.number} دون اعتماد`); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تأكيد الحفظ'); }
    finally { setBusy(false); }
  }
  return <Card className="p-4 space-y-4">
    <h2 className="font-semibold">عرض سعر جديد</h2>
    <p className="text-sm">الفرع 1 · دون ضريبة · خصم مباشر للوحدة</p>
    {success && <p role="status">{success}</p>}
    {error && <p role="alert">{error}</p>}
    {pending ? <div className="space-y-3">
      <p>يوجد طلب لم تُؤكَّد نتيجته. أعد التحقق من الحفظ بنفس الطلب لمنع إنشاء عرض مكرر.</p>
      <p>العميل: {pending.customerCode} · الأصناف: {pending.lines.length} · العملة: {pending.currencyCode}</p>
      <Button disabled={busy} onClick={save}>التحقق وإعادة محاولة الحفظ</Button>
    </div> : <>
      <fieldset disabled={busy} onChange={() => setPreview(null)} className="space-y-3">
        <Input aria-label="بحث العميل" placeholder="ابحث باسم العميل أو رقمه" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
        <Select aria-label="العميل" value={customerCode} onChange={e => setCustomer(e.target.value)}>
          <option value="">اختر العميل</option>{customers.data?.map(c => <option key={c.externalCustomerCode} value={c.externalCustomerCode}>{c.nameAr} — {c.externalCustomerCode}</option>)}
        </Select>
        <Select aria-label="العملة" value={currencyCode} onChange={e => setCurrency(e.target.value)}><option value="SR">ريال سعودي</option><option value="YR">ريال يمني</option><option value="$">دولار أمريكي</option></Select>
        <Select aria-label="المستودع" value={warehouseCode} onChange={e => setWarehouse(e.target.value)}><option value="">اختر المستودع</option>{warehouses.data?.map(w => <option key={w.externalWarehouseCode} value={w.externalWarehouseCode}>{w.nameAr}</option>)}</Select>
        {(customers.isError || warehouses.isError || items.isError) && <p role="alert">تعذر تحميل دليل العملاء أو الأصناف أو المستودعات</p>}
        <Input aria-label="بحث الصنف" placeholder="ابحث عن صنف بحرفين أو أكثر" value={itemSearch} onChange={e => setItemSearch(e.target.value)} />
        <div className="flex flex-wrap gap-2">{items.data?.map(item => <Button key={item.code} variant="secondary" disabled={!item.units.length || lines.length >= 50} onClick={() => {
          setLines([...lines, { itemCode: item.code, unitCode: item.units[0].code, quantity: '1', price: '', discount: '0' }]); setPreview(null);
        }}>{item.name}</Button>)}</div>
        {lines.map((line, index) => <div key={index} className="grid gap-2 sm:grid-cols-6">
          <span>{line.itemCode} · {line.unitCode}</span>
          <Input aria-label={`كمية السطر ${index+1}`} placeholder="الكمية" value={line.quantity} onChange={e => changeLine(index, 'quantity', e.target.value)} />
          <Input aria-label={`سعر السطر ${index+1}`} placeholder="سعر الوحدة" value={line.price} onChange={e => changeLine(index, 'price', e.target.value)} />
          <Input aria-label={`خصم السطر ${index+1}`} placeholder="خصم الوحدة" value={line.discount} onChange={e => changeLine(index, 'discount', e.target.value)} />
          <Button variant="secondary" onClick={() => { setLines(lines.filter((_, i) => i !== index)); setPreview(null); }}>حذف السطر</Button>
        </div>)}
        <Textarea aria-label="ملاحظات العرض" placeholder="ملاحظات" value={notes} onChange={e => setNotes(e.target.value)} />
      </fieldset>
      <Button variant="secondary" disabled={busy || !reference || !customerCode || !warehouseCode || !lines.length} onClick={validate}>معاينة العرض</Button>
      {preview && <div className="space-y-2"><p>قيمة الأصناف: {preview.gross} · الخصم: {preview.discount} · الصافي: {preview.net} {currencyCode}</p>
        <Button disabled={busy} onClick={save}>حفظ عرض السعر دون اعتماد</Button></div>}
    </>}
  </Card>;
}
