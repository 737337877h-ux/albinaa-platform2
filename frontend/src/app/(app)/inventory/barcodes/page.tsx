'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import JsBarcode from 'jsbarcode';
import { CheckCircle2, CircleSlash, Download, History, Printer, Search, ScanBarcode } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { Badge, Button, Card, Field, Input, Select } from '@/components/ui/primitives';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import type { OracleItemsResponse } from '@/lib/oracle-inventory';
import { fmtDateTime } from '@/lib/format';
import { toast } from '@/components/ui/toast';
import { BarcodePlatformPrint } from '@/components/barcode-platform-print';

function escapeZpl(value: string) { return value.replace(/[\^~]/g, ' '); }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char)); }

type BarcodePrintReport = {
  summary: { totalItems: number; printedItems: number; unprintedItems: number; totalCopies: number };
  printed: Array<{ itemCode: string; itemName: string; totalCopies: number; printEvents: number; lastPrintedAt: string; lastPrintedBy: string | null }>;
  unprinted: Array<{ externalItemCode: string; nameAr: string }>;
};

export default function InventoryBarcodesPage() {
  const can = useCan();
  const allowed = can('inventory.read');
  const [search, setSearch] = useState('');
  const [unprintedSearch, setUnprintedSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [widthMm, setWidthMm] = useState('50');
  const [heightMm, setHeightMm] = useState('25');
  const [copies, setCopies] = useState('1');
  const [dpi, setDpi] = useState('203');
  const [showName, setShowName] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const barcodeRef = useRef<SVGSVGElement>(null);
  useEffect(() => { const timer = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  const items = useQuery<OracleItemsResponse>({
    queryKey: ['barcode-items', debounced],
    queryFn: () => api(`/oracle-inventory/items?search=${encodeURIComponent(debounced)}&page=1&limit=30&status=active`),
    enabled: allowed,
  });
  const report = useQuery<BarcodePrintReport>({
    queryKey: ['barcode-print-report'],
    queryFn: () => api('/oracle-inventory/barcode-prints/report'),
    enabled: allowed,
  });
  const recordPrint = useMutation({
    mutationFn: (channel: 'print_dialog' | 'zpl_download') => api('/oracle-inventory/barcode-prints', {
      method: 'POST',
      body: JSON.stringify({ itemCode: selected?.externalItemCode, copies: Number(copies || 1), channel }),
    }),
    onSuccess: () => report.refetch(),
    onError: (error: Error) => toast(`تم تجهيز الملصق، لكن تعذر تسجيله في السجل: ${error.message}`, 'err'),
  });
  const availableItems = useMemo(() => (items.data?.items ?? []).filter((item) => Number(item.totalAvailablePrimaryQuantity) > 0), [items.data]);
  const filteredUnprinted = useMemo(() => {
    const query = unprintedSearch.trim().toLocaleLowerCase('ar');
    const rows = report.data?.unprinted ?? [];
    if (!query) return rows.slice(0, 100);
    return rows.filter((item) => `${item.externalItemCode} ${item.nameAr}`.toLocaleLowerCase('ar').includes(query)).slice(0, 100);
  }, [report.data?.unprinted, unprintedSearch]);
  const selected = availableItems.find((item) => item.externalItemCode === selectedCode) ?? availableItems[0];
  useEffect(() => { if ((!selectedCode || !availableItems.some((item) => item.externalItemCode === selectedCode)) && availableItems[0]) setSelectedCode(availableItems[0].externalItemCode); }, [availableItems, selectedCode]);
  useEffect(() => {
    if (!selected || !barcodeRef.current) return;
    JsBarcode(barcodeRef.current, selected.externalItemCode, {
      format: 'CODE128', displayValue: false, margin: 0, width: 2, height: 64,
    });
  }, [selected]);
  const zpl = useMemo(() => {
    if (!selected) return '';
    const dotsPerMm = Number(dpi) / 25.4;
    const width = Math.max(200, Math.round(Number(widthMm || 50) * dotsPerMm));
    const height = Math.max(160, Math.round(Number(heightMm || 25) * dotsPerMm));
    const rows = ['^XA', `^PW${width}`, `^LL${height}`, '^CI28'];
    // Allow long Arabic item names to wrap to two lines instead of being cut off.
    if (showName) rows.push(`^FO25,5^A0N,22,22^FB${width - 50},2,0,C^FD${escapeZpl(selected.nameAr)}^FS`);
    rows.push(`^FO35,58^BY2,2,62^BCN,62,Y,N,N^FD${escapeZpl(selected.externalItemCode)}^FS`);
    if (showCode) rows.push(`^FO25,150^A0N,24,24^FB${width - 50},1,0,C^FD${escapeZpl(selected.externalItemCode)}^FS`);
    rows.push(`^PQ${Math.max(1, Number(copies || 1))},0,1,N`, '^XZ');
    return rows.join('\n');
  }, [copies, dpi, heightMm, selected, showCode, showName, widthMm]);
  const downloadZpl = () => {
    if (!selected || !zpl) return;
    const url = URL.createObjectURL(new Blob([zpl], { type: 'application/octet-stream' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `barcode-${selected.externalItemCode}.zpl`; anchor.click(); URL.revokeObjectURL(url);
    recordPrint.mutate('zpl_download');
  };
  const printPreview = () => {
    if (!selected || !barcodeRef.current) return;
    const width = Math.max(20, Number(widthMm) || 50);
    const height = Math.max(15, Number(heightMm) || 25);
    const totalCopies = Math.min(999, Math.max(1, Number(copies) || 1));
    const printBarcode = barcodeRef.current.cloneNode(true) as SVGSVGElement;
    // Fit bars to the physical label area instead of letterboxing the SVG.
    // The label padding supplies the quiet zones on both sides.
    printBarcode.setAttribute('preserveAspectRatio', 'none');
    const svg = printBarcode.outerHTML;
    const label = `<section class="label">${showName ? `<strong>${escapeHtml(selected.nameAr)}</strong>` : ''}${svg}${showCode ? `<span>${escapeHtml(selected.externalItemCode)}</span>` : ''}</section>`;
    const popup = window.open('', '_blank', 'popup=yes,width=620,height=520');
    if (!popup) return;
    popup.document.open();
    popup.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>ملصق ${escapeHtml(selected.externalItemCode)}</title><style>
      @page { size: ${width}mm ${height}mm; margin: 0; }
      * { box-sizing: border-box; }
      html, body { width: ${width}mm; margin: 0; padding: 0; background: #fff; color: #000; font-family: Tahoma, Arial, sans-serif; }
      .label { width: ${width}mm; height: ${height}mm; padding: 1.2mm 2mm; display: grid; grid-template-rows: ${showName ? '6mm ' : ''}minmax(0, 1fr)${showCode ? ' 3.5mm' : ''}; gap: .4mm; align-items: center; overflow: hidden; page-break-after: always; break-after: page; }
      .label:last-child { page-break-after: auto; break-after: auto; }
      strong { width: 100%; text-align: center; font-size: 6.5pt; line-height: 1.05; white-space: normal; overflow-wrap: anywhere; overflow: visible; }
      svg { display: block; width: 100% !important; height: 100% !important; min-height: 0; margin: 0 !important; }
      span { direction: ltr; text-align: center; font-size: 10pt; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
      @media screen { body { margin: 12mm auto; box-shadow: 0 0 18px #777; } }
    </style></head><body>${Array.from({ length: totalCopies }, () => label).join('')}<script>window.onload=()=>setTimeout(()=>window.print(),150);<\/script></body></html>`);
    popup.document.close();
    recordPrint.mutate('print_dialog');
  };
  if (!allowed) return <Card><PermissionNotice message="لا تملك صلاحية إدارة باركود المخزون." /></Card>;
  return <div className="barcode-print-page space-y-5">
    <PageHeader title="تصميم وطباعة الباركود" action={<Badge tone="pine">ZDesigner GK888t</Badge>} />
    <Card className="border-r-4 border-r-brand p-4"><p className="font-semibold">طباعة عبر تعريف Zebra في Windows</p><p className="mt-1 text-xs text-ink-mid">أرسل الملصق إلى الطابعة المتصلة بجهاز المنصة عبر USB. اضبط المقاس ليطابق رول الملصقات.</p></Card>
    <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
      <Card className="p-4">
        <div className="relative"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-low" /><Input className="pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بكود الصنف أو الاسم أو الباركود" /></div>
        <DataState isLoading={items.isLoading} isError={items.isError} error={items.error} onRetry={() => items.refetch()} isFetching={items.isFetching} isEmpty={availableItems.length === 0} emptyTitle="لا توجد أصناف ذات رصيد متاح">
          <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{availableItems.map((item) => <button key={item.externalItemCode} type="button" onClick={() => setSelectedCode(item.externalItemCode)} className={`w-full rounded-lg border p-3 text-right ${selected?.externalItemCode === item.externalItemCode ? 'border-brand bg-surface-2' : 'border-line'}`}><p className="font-semibold">{item.nameAr}</p><div className="mt-1 flex items-center justify-between gap-3 text-xs text-ink-mid"><span className="tnum">{item.externalItemCode}</span><span>المتوفر: <b className="tnum text-ink">{Number(item.totalAvailablePrimaryQuantity).toLocaleString('en-US')}</b></span></div></button>)}</div>
        </DataState>
      </Card>
      <Card className="p-4">
        <h2 className="flex items-center gap-2 font-semibold"><ScanBarcode className="h-5 w-5 text-brand" />إعداد الملصق</h2>
        <div className="mt-4 grid grid-cols-2 gap-3"><Field label="العرض (مم)"><Input type="number" min="20" value={widthMm} onChange={(event) => setWidthMm(event.target.value)} /></Field><Field label="الارتفاع (مم)"><Input type="number" min="15" value={heightMm} onChange={(event) => setHeightMm(event.target.value)} /></Field><Field label="عدد النسخ"><Input type="number" min="1" max="999" value={copies} onChange={(event) => setCopies(event.target.value)} /></Field><Field label="دقة الطابعة"><Select value={dpi} onChange={(event) => setDpi(event.target.value)}><option value="203">203 DPI</option><option value="300">300 DPI</option></Select></Field></div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={showName} onChange={(event) => setShowName(event.target.checked)} />اسم الصنف</label><label className="flex items-center gap-2"><input type="checkbox" checked={showCode} onChange={(event) => setShowCode(event.target.checked)} />كود الصنف</label></div>
        <div className="print-label mt-5 flex min-h-44 flex-col items-center justify-center rounded-lg border-2 border-dashed border-line bg-white p-4 text-black" style={{ width: '100%', aspectRatio: `${widthMm}/${heightMm}` }}><p className="text-center font-bold">{showName ? selected?.nameAr ?? 'اختر الصنف' : ''}</p><svg ref={barcodeRef} className="my-3 max-w-full" aria-label={selected ? `باركود الصنف ${selected.externalItemCode}` : 'اختر الصنف'} /><p className="tnum text-center">{showCode ? selected?.externalItemCode ?? '—' : ''}</p></div>
        <BarcodePlatformPrint label={selected?{itemCode:selected.externalItemCode,itemName:selected.nameAr,widthMm:Number(widthMm),heightMm:Number(heightMm),copies:Number(copies),showName,showCode}:null}/>
        <div className="desktop-print-options mt-4 flex gap-2"><Button className="flex-1" onClick={downloadZpl} disabled={!selected}><Download className="h-4 w-4" />تنزيل ZPL</Button><Button className="flex-1" variant="secondary" onClick={printPreview} disabled={!selected}><Printer className="h-4 w-4" />معاينة وطباعة</Button></div>
      </Card>
    </div>
    <section className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-ink-mid">إجمالي الأصناف</p><p className="tnum mt-1 text-2xl font-black">{report.data?.summary.totalItems ?? '—'}</p></Card>
        <Card className="border-r-4 border-r-credit-500 p-4"><p className="text-xs text-ink-mid">أصناف جُهزت للطباعة</p><p className="tnum mt-1 text-2xl font-black text-credit-600">{report.data?.summary.printedItems ?? '—'}</p></Card>
        <Card className="border-r-4 border-r-hazard-500 p-4"><p className="text-xs text-ink-mid">لم تُطبع بعد</p><p className="tnum mt-1 text-2xl font-black text-hazard-600">{report.data?.summary.unprintedItems ?? '—'}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-mid">إجمالي النسخ المطلوبة</p><p className="tnum mt-1 text-2xl font-black">{report.data?.summary.totalCopies ?? '—'}</p></Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <h2 className="flex items-center gap-2 font-semibold"><History className="h-5 w-5 text-brand" />سجل الأصناف المطبوعة</h2>
          <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
            {(report.data?.printed ?? []).map((item) => <div key={item.itemCode} className="rounded-lg border border-line p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.itemName}</p><p className="tnum text-xs text-ink-mid">{item.itemCode}</p></div><Badge tone="pine">{item.totalCopies} نسخة · {item.printEvents} مرة</Badge></div><p className="mt-2 text-xs text-ink-mid">آخر تجهيز: {fmtDateTime(item.lastPrintedAt)} · {item.lastPrintedBy ?? 'مستخدم غير محدد'}</p></div>)}
            {!report.isLoading && !(report.data?.printed.length) && <p className="py-8 text-center text-sm text-ink-mid">لم تُسجّل طباعة باركود بعد.</p>}
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="flex items-center gap-2 font-semibold"><CircleSlash className="h-5 w-5 text-hazard-600" />أصناف لم تُطبع</h2>
          <p className="mt-1 text-xs text-ink-mid">ابحث في كل الأصناف النشطة التي لم يُفتح لها أمر طباعة ولم يُنزّل لها ZPL. تظهر أول 100 نتيجة فقط لتبقى الصفحة سريعة.</p>
          <div className="relative mt-3"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-low" /><Input className="pr-9" value={unprintedSearch} onChange={(event) => setUnprintedSearch(event.target.value)} placeholder="بحث في الأصناف غير المطبوعة" /></div>
          <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
            {filteredUnprinted.map((item) => <button key={item.externalItemCode} type="button" onClick={() => { setSearch(item.externalItemCode); setSelectedCode(item.externalItemCode); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="flex w-full items-center justify-between gap-3 rounded-lg border border-line p-3 text-right hover:bg-surface-2"><span><strong className="block">{item.nameAr}</strong><span className="tnum text-xs text-ink-mid">{item.externalItemCode}</span></span><CheckCircle2 className="h-4 w-4 text-ink-low" /></button>)}
            {!report.isLoading && filteredUnprinted.length === 0 && <p className="py-8 text-center text-sm text-ink-mid">لا توجد نتائج مطابقة.</p>}
          </div>
        </Card>
      </div>
    </section>
  </div>;
}
