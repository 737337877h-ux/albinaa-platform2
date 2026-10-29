'use client';
import { useEffect, useState } from 'react';
import { apiFileBlob } from '@/lib/api';
import { Button, Field, Input, Select } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { smartStatementDate } from '@/lib/smart-date';
import { contactLinks } from '@/lib/contact';
import { registerContactAttempt } from '@/lib/contact-attempt';

export function StatementReminderAttachment({ customerId, message, phone, windowsWhatsApp = false }: { customerId: string; message: string; phone?: string; windowsWhatsApp?: boolean }) {
  const links = contactLinks(phone, message);
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toLocaleDateString('en-CA'));
  const [currency, setCurrency] = useState('YER');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setFile(null); setUrl(''); }, [customerId, from, to, currency]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const prepare = async () => {
    const start = smartStatementDate(from), end = smartStatementDate(to);
    if (!start || !end || start > end || start < '2020-01-01' || end > '2026-12-31') { toast('حدد فترة صحيحة من 2020 إلى 2026', 'err'); return; }
    setBusy(true);
    try {
      const params = new URLSearchParams({ source: 'oracle_archive', template: 'branded', currency, fromDate: start, toDate: end });
      const blob = await apiFileBlob(`/customers/${encodeURIComponent(customerId)}/statement.pdf?${params}`);
      if (await blob.slice(0, 5).text() !== '%PDF-') throw new Error('الملف المستلم ليس كشف PDF صالحًا');
      setFile(new File([blob], `statement-${currency}-${start}-${end}.pdf`, { type: 'application/pdf' }));
      setUrl(URL.createObjectURL(blob));
    } catch (error) { toast(error instanceof Error ? error.message : 'تعذر تجهيز الكشف', 'err'); }
    finally { setBusy(false); }
  };
  const share = async () => {
    if (!file) return;
    try {
      if (!navigator.canShare?.({ files: [file] })) { toast('هذا المتصفح لا يدعم مشاركة الملفات؛ نزّل الكشف وأرفقه يدويًا في واتساب.', 'err'); return; }
      await navigator.share({ files: [file], text: message, title: 'تنبيه بكشف حساب' });
    } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) toast('تعذر فتح المشاركة؛ يمكنك تنزيل الملف وإرفاقه يدويًا.', 'err'); }
  };
  const openCustomerChat = () => {
    if (!links) return;
    const attempt = registerContactAttempt(customerId, 'whatsapp');
    window.location.assign(windowsWhatsApp ? links.whatsappWindows : links.whatsapp);
    void attempt.catch(() => toast('تعذر حفظ محاولة التواصل؛ سجّل المتابعة يدويًا.', 'err'));
  };
  return <div className="space-y-3 rounded-xl border p-3">
    <p className="text-sm font-bold">تنبيه بكشف حساب — إرفاق PDF</p>
    <div className="grid grid-cols-2 gap-2">
      <Field label="من تاريخ"><Input placeholder="010125 أو 1/1/2025" disabled={busy} value={from} onChange={e => setFrom(e.target.value)} onBlur={() => { const value = smartStatementDate(from); if (value) setFrom(value); }} /></Field>
      <Field label="إلى تاريخ"><Input placeholder="311225 أو 31/12/2025" disabled={busy} value={to} onChange={e => setTo(e.target.value)} onBlur={() => { const value = smartStatementDate(to); if (value) setTo(value); }} /></Field>
    </div>
    <Field label="عملة الكشف"><Select disabled={busy} value={currency} onChange={e => setCurrency(e.target.value)}><option value="YER">ريال يمني</option><option value="SAR">ريال سعودي</option><option value="USD">دولار</option></Select></Field>
    <Button type="button" loading={busy} onClick={prepare}>إعداد كشف الحساب</Button>
    {file && <div className="flex flex-wrap gap-3"><a href={url} target="_blank" rel="noreferrer">معاينة الكشف</a><a href={url} download={file.name}>تنزيل PDF لإرفاقه</a><Button type="button" disabled={!links || !message.trim()} onClick={openCustomerChat}>فتح محادثة العميل مع الرسالة</Button><Button type="button" onClick={share}>مشاركة عامة (اختيار المستلم)</Button></div>}
    {file && <p className="text-xs">المحادثة للرقم المحدد أعلاه: {phone || 'لا يوجد رقم صالح'}. تُعبّأ الرسالة دون إرسال؛ أرفق PDF الذي نزّلته من داخل المحادثة.</p>}
    <p className="text-xs">الكشف من المنصة ببيانات Oracle؛ لكل عملة ملف مستقل. راجع المستلم قبل الإرسال. فتح محادثة واتساب وحده لا يرفق الملف؛ استخدم المشاركة أو الإرفاق اليدوي. الرسائل النصية لا ترفق PDF.</p>
  </div>;
}
