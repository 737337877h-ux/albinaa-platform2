'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Banknote, Building2, Wallet, CircleHelp, Eye, Search, UserRound, ChevronDown, FileText } from 'lucide-react';
import { Badge, Button, Input } from '@/components/ui/primitives';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { receiptMethod } from '@/lib/receipt-request-display';

type Request = {
  requestNo: string; requestSerial: string; status: string; createdAt?: string | null;
  statusLabel?: string; statusVerified?: boolean;
  amount?: number | string | null; currencyCode?: string | null;
  recipientName?: string | null; platformCustomerCode?: string | null; platformCustomerId?: string | null;
  collectorName?: string | null; collectorNo?: string | null; description?: string | null;
  paymentMethod?: string | null;
  attachment?: { fileName: string; previewPath: string };
};
const statusNames: Record<string, string> = { pending_approval: 'بانتظار الاعتماد', rejected: 'مرفوض', inactive: 'موقوف', approved: 'معتمد', cancelled:'ملغي', unknown:'تعذر التحقق من حالة الطلب' };

export function ReceiptRequestList<T extends Request>({ items, onPreview }: { items: T[]; onPreview: (item: T) => void }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [method, setMethod] = useState('all');
  const term = search.trim().replace(/[أإآ]/g, 'ا').toLowerCase();
  const filtered = items.filter(item => (status === 'all' || item.status === status)
    && (method === 'all' || receiptMethod(item).key === method)
    && [item.recipientName, item.platformCustomerCode, item.collectorName, item.collectorNo, item.requestNo, item.description]
      .join(' ').replace(/[أإآ]/g, 'ا').toLowerCase().includes(term));
  return <div className="p-4 sm:p-5" dir="rtl">
    <div className="mb-5 grid gap-3 rounded-xl border border-line bg-surface-2 p-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
      <div className="relative"><Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-ink-mid" />
        <Input aria-label="البحث في طلبات القبض" className="pr-10" placeholder="ابحث بالعميل، رقم الحساب، الطلب أو المحصل…" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <select aria-label="حالة الطلب" className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-ink-hi" value={status} onChange={e => setStatus(e.target.value)}>
        <option value="all">جميع الحالات</option><option value="pending_approval">بانتظار الاعتماد</option><option value="rejected">مرفوضة</option><option value="inactive">موقوفة</option><option value="unknown">غير متحققة</option><option value="cancelled">ملغاة</option>
      </select>
      <select aria-label="طريقة التحصيل" className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-ink-hi" value={method} onChange={e => setMethod(e.target.value)}>
        <option value="all">كل طرق التحصيل</option><option value="cash">نقدي</option><option value="bank">حوالة</option><option value="wallet">محفظة</option><option value="unknown">غير محددة</option>
      </select>
    </div>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-mid"><span>{filtered.length} طلب من {items.length}</span><span>السندات المعتمدة تظهر في سجل التحصيلات</span></div>
    <div className="grid items-start gap-4 xl:grid-cols-2">
      {filtered.map(item => {
        const payment = receiptMethod(item);
        const Icon = payment.key === 'cash' ? Banknote : payment.key === 'bank' ? Building2 : payment.key === 'wallet' ? Wallet : CircleHelp;
        return <article key={`${item.requestSerial}:${item.requestNo}:${item.collectorNo}`} className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-sm transition-shadow hover:shadow-md">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-pine-500/5 px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-bold"><FileText className="h-4 w-4 text-pine-500" />طلب قبض <span className="tnum" dir="ltr">#{item.requestNo}</span></span>
            <Badge tone={item.status === 'pending_approval' || item.status === 'unknown' ? 'hazard' : item.status === 'approved' ? 'credit' : 'debt'}>{item.statusLabel ?? statusNames[item.status] ?? 'حالة غير محددة'}</Badge>
          </header>
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1"><p className="mb-1 text-xs text-ink-mid">العميل / صاحب الحساب</p>
                {item.platformCustomerId ? <Link className="break-words text-base font-bold text-ink-hi hover:underline" href={`/customers/${item.platformCustomerId}`}>{item.recipientName || 'اسم العميل غير متاح'}</Link>
                  : <h3 className="break-words text-base font-bold text-ink-hi">{item.recipientName || 'اسم العميل غير متاح'}</h3>}
                <p className="mt-1 text-xs text-ink-mid">رقم الحساب: <span className="tnum font-semibold" dir="ltr">{item.platformCustomerCode || 'غير متاح'}</span></p>
              </div>
              <div className="rounded-xl bg-pine-500/10 px-4 py-3 text-left"><p className="mb-1 text-xs text-ink-mid">مبلغ الطلب</p><p className="tnum text-xl font-extrabold text-ink-hi" dir="ltr">{item.amount != null ? fmtMoney(Number(item.amount)) : '—'} <span className="text-xs font-semibold">{item.currencyCode || ''}</span></p></div>
            </div>
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
              <div><p className="mb-1 text-[11px] text-ink-mid">طريقة التحصيل</p><p className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 shrink-0 text-pine-500" />{payment.label}</p>{payment.inferred && <p className="mt-1 text-[10px] text-ink-mid">بحسب بيان السند</p>}</div>
              <div><p className="mb-1 text-[11px] text-ink-mid">المحصل</p><p className="flex items-start gap-2 text-sm font-semibold"><UserRound className="mt-0.5 h-4 w-4 shrink-0 text-pine-500" />{item.collectorName || 'غير محدد'}</p>{item.collectorNo && <p className="mt-1 text-[10px] text-ink-mid">رقم المحصل: {item.collectorNo}</p>}</div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-ink-mid">{item.createdAt ? fmtDateTime(item.createdAt) : 'التاريخ غير متاح'}</span>
              {item.attachment ? <Button variant="secondary" onClick={() => onPreview(item)}><Eye className="h-4 w-4" />معاينة الإيصال</Button> : <span className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-mid">لا يوجد إيصال مرتبط مؤكّد</span>}
            </div>
            <details className="group border-t border-line pt-3"><summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-ink-mid">البيان وتفاصيل الطلب<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary>
              <p className="mt-3 break-words text-sm leading-7 text-ink-hi">{item.description || 'لا يوجد بيان مسجل'}</p>
              <p className="mt-2 text-[11px] text-ink-mid">معرّف الطلب الكامل</p><p className="mt-1 break-all font-mono text-xs text-ink-mid" dir="ltr">{item.requestSerial}</p>
            </details>
          </div>
        </article>;
      })}
    </div>
    {items.length > 0 && filtered.length === 0 && <p className="py-8 text-center text-sm text-ink-mid">لا توجد طلبات مطابقة. جرّب تغيير البحث أو التصفية.</p>}
  </div>;
}
