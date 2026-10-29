'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ClipboardCheck, Plus, Search, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { PermissionNotice } from '@/components/ui/data-state';
import { Badge, Button, Card, CardHeader, Field, Input, Select } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import type { OracleInventoryItem, OracleItemsResponse } from '@/lib/oracle-inventory';

type Issue = { severity: 'error' | 'warning'; code: string; message: string };
type InventoryCountResult = {
  mode: 'SELECT_ONLY' | 'DRY_RUN'; oracleWrite: 'NONE'; schema: 'IAS20261'; valid?: boolean;
  inventoryType: null | { code: string; nameAr: string; nameEn: string | null; addAllowed: boolean; viewAllowed: boolean };
  document: null | {
    number: string; type: string; serial: string; date: string | null; description: string | null;
    annual: boolean; processed: boolean; externalPost: boolean; branchNo: number | null; branchYear: number | null;
  };
  lines: Array<{
    lineNo: number; itemCode: string; itemNameAr: string; itemNameEn: string | null;
    unitCode: string; warehouseCode: string;
    countedQuantity: string | null; packageSize: string | null; packageQuantity: string | null;
    availableQuantity: string | null; differenceQuantity: string | null;
    conversionProven: boolean; processedAdjustment: boolean;
  }>;
  issues?: Issue[];
};

type DraftLine = { id: number; itemCode: string; itemNameAr: string; unitCode: string; countedQuantity: string };
type InventoryCreateResult = {
  valid?: boolean; mode?: 'DRY_RUN'; oracleWrite: 'NONE' | 'INSERT_ONLY'; schema: 'IAS20261';
  documentNo?: string; documentSerial?: string; inventoryType?: string | { code: string; nameAr: string };
  warehouseCode?: string; lineCount?: number; created?: boolean;
  lines?: Array<{
    lineNo: number; itemCode: string; itemNameAr: string; unitCode: string; warehouseCode: string;
    countedQuantity: number; availableQuantity: number; differenceQuantity: number;
  }>;
};

let nextLineId = 1;
const newLine = (): DraftLine => ({ id: nextLineId++, itemCode: '', itemNameAr: '', unitCode: 'حبة', countedQuantity: '' });

const message = (error: unknown) => error instanceof ApiError ? error.message : 'تعذر قراءة مستند الجرد';

export default function OracleInventoryCountsPage() {
  const can = useCan();
  const canRead = can('oracle_test_requests.inventory_count.read');
  const canDryRun = can('oracle_test_requests.inventory_count.dry_run');
  const canCreate = can('oracle_test_requests.inventory_count.create');
  const [documentNo, setDocumentNo] = useState('');
  const [inventoryType, setInventoryType] = useState('2');
  const [branchNo, setBranchNo] = useState('1');
  const [branchYear, setBranchYear] = useState(String(new Date().getFullYear()));
  const [result, setResult] = useState<InventoryCountResult | null>(null);
  const [draftType, setDraftType] = useState('2');
  const [draftWarehouseCode, setDraftWarehouseCode] = useState('102');
  const [description, setDescription] = useState('جرد من منصة البناء الراقي');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([newLine()]);
  const [externalReference, setExternalReference] = useState(() => `inventory-count:web:${crypto.randomUUID()}`);
  const [draftPreview, setDraftPreview] = useState<InventoryCreateResult | null>(null);

  const draftPayload = () => ({
    externalReference, inventoryType: Number(draftType), warehouseCode: Number(draftWarehouseCode), description,
    lines: draftLines.map((line) => ({
      itemCode: line.itemCode.trim(), unitCode: line.unitCode.trim(),
      countedQuantity: Number(line.countedQuantity),
    })),
  });
  const invalidateDraft = () => setDraftPreview(null);
  const updateDraftLine = (id: number, key: keyof Omit<DraftLine, 'id'>, value: string) => {
    setDraftLines((current) => current.map((line) => line.id === id ? { ...line, [key]: value } : line));
    invalidateDraft();
  };

  const path = () => {
    const params = new URLSearchParams({ inventoryType, branchNo, branchYear });
    return `/oracle-test-requests/inventory-counts/${documentNo}?${params.toString()}`;
  };
  const dryRunPath = () => {
    const params = new URLSearchParams({ inventoryType, branchNo, branchYear });
    return `/oracle-test-requests/inventory-counts/${documentNo}/dry-run?${params.toString()}`;
  };
  const load = useMutation({
    mutationFn: () => api<InventoryCountResult>(path()),
    onSuccess: (value) => { setResult(value); toast(value.document ? 'تم تحميل مستند الجرد للقراءة' : 'لم يُعثر على المستند', value.document ? 'ok' : 'err'); },
    onError: (error) => toast(message(error), 'err'),
  });
  const dryRun = useMutation({
    mutationFn: () => api<InventoryCountResult>(dryRunPath(), { method: 'POST' }),
    onSuccess: (value) => { setResult(value); toast(value.valid ? 'نجح Dry Run — لم تُجرَ أي كتابة في Oracle' : 'Dry Run يحتاج معالجة', value.valid ? 'ok' : 'err'); },
    onError: (error) => toast(message(error), 'err'),
  });
  const draftDryRun = useMutation({
    mutationFn: () => api<InventoryCreateResult>('/oracle-test-requests/inventory-counts/dry-run', {
      method: 'POST', body: JSON.stringify(draftPayload()),
    }),
    onSuccess: (value) => { setDraftPreview(value); toast('نجح فحص المسودة — لم تُجرَ أي كتابة في Oracle', 'ok'); },
    onError: (error) => { setDraftPreview(null); toast(message(error), 'err'); },
  });
  const createDraft = useMutation({
    mutationFn: () => api<InventoryCreateResult>('/oracle-test-requests/inventory-counts', {
      method: 'POST', body: JSON.stringify(draftPayload()),
    }),
    onSuccess: (value) => {
      setDraftPreview(value);
      if (value.documentNo) setDocumentNo(value.documentNo);
      toast(value.created === false ? `المسودة موجودة مسبقًا برقم ${value.documentNo}` : `تم إنشاء مسودة الجرد رقم ${value.documentNo}`, 'ok');
      setExternalReference(`inventory-count:web:${crypto.randomUUID()}`);
    },
    onError: (error) => toast(message(error), 'err'),
  });

  if (!canRead && !canCreate) return <PermissionNotice message="لا تملك صلاحية عرض الجرد أو إنشاء مسودته" />;

  return (
    <div className="space-y-5">
      <PageHeader title="مسودات الجرد INVT008.230" action={<Badge tone="credit">IAS20261</Badge>} />

      <Card className="border-credit-700/40 p-4">
        <div className="flex items-start gap-3">
          <ClipboardCheck className="mt-0.5 h-5 w-5 text-brand" aria-hidden />
          <div>
            <p className="font-semibold">إنشاء مسودة جرد متعددة الأصناف</p>
            <p className="mt-1 text-sm text-ink-mid">تُنشأ مسودة غير معتمدة في IAS20261 عبر بوابة الجرد المقيدة. الفحص قراءة فقط، والحفظ لا ينشئ تسوية فرق ولا يرحّل حركة مخزون.</p>
          </div>
        </div>
      </Card>

      {canCreate && <Card>
        <CardHeader title="مسودة جرد جديدة" action={<Badge tone="credit">IAS20261</Badge>} />
        <div className="grid gap-4 p-4 md:grid-cols-3">
          <Field label="نوع الجرد">
            <Select value={draftType} onChange={(event) => { setDraftType(event.target.value); invalidateDraft(); }}>
              <option value="1">1 — جرد يدوي</option>
              <option value="2">2 — جرد تطبيق</option>
            </Select>
          </Field>
          <Field label="المخزن الافتراضي"><Input inputMode="numeric" value={draftWarehouseCode} onChange={(event) => { setDraftWarehouseCode(event.target.value); invalidateDraft(); }} /></Field>
          <Field label="البيان"><Input value={description} onChange={(event) => { setDescription(event.target.value); invalidateDraft(); }} /></Field>
        </div>
        <div className="space-y-3 border-t border-line p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">الأصناف ({draftLines.length})</h3>
            <Button variant="secondary" onClick={() => { setDraftLines((current) => [...current, newLine()]); invalidateDraft(); }}>
              <Plus className="h-4 w-4" />إضافة صنف
            </Button>
          </div>
          {draftLines.map((line, index) => {
            const previewLine = draftPreview?.lines?.find((item) => item.lineNo === index + 1);
            return <div key={line.id} className="grid gap-3 rounded-lg border border-line bg-surface-2 p-3 md:grid-cols-2 md:items-end xl:grid-cols-[auto_2fr_1fr_1fr_1fr_1fr_auto]">
              <span className="pb-3 text-sm font-bold text-ink-mid">{index + 1}</span>
              <InventoryCountItemPicker
                index={index}
                itemCode={line.itemCode}
                itemNameAr={line.itemNameAr}
                onChange={(itemCode, itemNameAr) => {
                  setDraftLines((current) => current.map((item) => item.id === line.id ? { ...item, itemCode, itemNameAr } : item));
                  invalidateDraft();
                }}
              />
              <Field label="الوحدة"><Input value={line.unitCode} onChange={(event) => updateDraftLine(line.id, 'unitCode', event.target.value)} /></Field>
              <Field label="كمية الجرد"><Input inputMode="decimal" value={line.countedQuantity} onChange={(event) => updateDraftLine(line.id, 'countedQuantity', event.target.value)} /></Field>
              <Field label="المتوفر"><Input value={previewLine ? String(previewLine.availableQuantity) : '—'} readOnly aria-label={`الكمية المتوفرة للسطر ${index + 1}`} /></Field>
              <Field label="الفارق"><Input value={previewLine ? String(previewLine.differenceQuantity) : '—'} readOnly aria-label={`فارق الجرد للسطر ${index + 1}`} /></Field>
              <Button variant="danger" disabled={draftLines.length === 1} onClick={() => { setDraftLines((current) => current.filter((item) => item.id !== line.id)); invalidateDraft(); }} aria-label={`حذف السطر ${index + 1}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>;
          })}
        </div>
        {draftPreview?.lines && <div className="mx-4 mb-4 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[680px] text-sm"><thead className="bg-surface-2 text-ink-mid"><tr>
            <th className="px-3 py-2 text-start">الصنف</th><th className="px-3 py-2 text-start">الاسم</th>
            <th className="px-3 py-2 text-start">المخزن</th><th className="px-3 py-2 text-start">الجرد</th>
            <th className="px-3 py-2 text-start">المتاح</th><th className="px-3 py-2 text-start">الفرق</th>
          </tr></thead><tbody>{draftPreview.lines.map((line) => <tr key={line.lineNo} className="border-t border-line">
            <td className="px-3 py-2" dir="ltr">{line.itemCode}</td><td className="px-3 py-2">{line.itemNameAr}</td>
            <td className="px-3 py-2">{line.warehouseCode}</td><td className="px-3 py-2">{line.countedQuantity}</td>
            <td className="px-3 py-2">{line.availableQuantity}</td><td className="px-3 py-2">{line.differenceQuantity}</td>
          </tr>)}</tbody></table>
        </div>}
        {draftPreview?.documentNo && <div className="mx-4 mb-4 rounded-lg border border-credit-700/40 bg-credit-700/10 p-3 text-sm text-credit-700">
          تم ربط مسودة الجرد رقم <strong>{draftPreview.documentNo}</strong> بالمسلسل <span dir="ltr">{draftPreview.documentSerial}</span>، دون معالجة أو ترحيل.
        </div>}
        <div className="flex flex-wrap gap-2 border-t border-line p-4">
          <Button variant="secondary" loading={draftDryRun.isPending} disabled={!description.trim() || !draftWarehouseCode || draftLines.some((line) => !line.itemCode.trim() || !line.unitCode.trim() || line.countedQuantity === '')} onClick={() => draftDryRun.mutate()}>Dry Run</Button>
          <Button loading={createDraft.isPending} disabled={draftPreview?.valid !== true || draftPreview.oracleWrite !== 'NONE'} onClick={() => createDraft.mutate()}>إنشاء مسودة الجرد</Button>
        </div>
      </Card>}

      {canRead && <Card>
        <CardHeader title="تحديد مستند الجرد" />
        <div className="grid gap-4 p-4 md:grid-cols-4">
          <Field label="رقم الجرد"><Input inputMode="numeric" value={documentNo} onChange={(event) => setDocumentNo(event.target.value)} /></Field>
          <Field label="نوع الجرد">
            <Select value={inventoryType} onChange={(event) => setInventoryType(event.target.value)}>
              <option value="1">1 — جرد يدوي</option><option value="2">2 — جرد تطبيق</option>
            </Select>
          </Field>
          <Field label="الفرع"><Input inputMode="numeric" value={branchNo} onChange={(event) => setBranchNo(event.target.value)} /></Field>
          <Field label="سنة الفرع"><Input inputMode="numeric" value={branchYear} onChange={(event) => setBranchYear(event.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line p-4">
          <Button variant="secondary" loading={load.isPending} disabled={!documentNo} onClick={() => load.mutate()}><Search className="h-4 w-4" />تحميل للقراءة</Button>
          {canDryRun && <Button loading={dryRun.isPending} disabled={!documentNo} onClick={() => dryRun.mutate()}>Dry Run</Button>}
        </div>
      </Card>}

      {result && (
        <Card>
          <CardHeader title={result.document ? `مستند الجرد رقم ${result.document.number}` : 'نتيجة الفحص'} action={
            <Badge tone={result.valid === false ? 'debt' : result.mode === 'DRY_RUN' ? 'credit' : 'pine'}>
              {result.mode === 'DRY_RUN' ? (result.valid ? 'Dry Run صالح' : 'يحتاج معالجة') : 'قراءة فقط'}
            </Badge>
          } />
          <div className="space-y-4 p-4">
            {!result.document ? <p className="text-sm text-debt-600">مستند الجرد غير موجود بالمعايير المحددة.</p> : (
              <>
                <div className="grid gap-3 rounded-lg bg-surface-2 p-4 text-sm md:grid-cols-3">
                  <div><span className="text-ink-mid">النوع: </span>{result.inventoryType?.nameAr ?? result.document.type}</div>
                  <div><span className="text-ink-mid">المسلسل: </span><span dir="ltr">{result.document.serial}</span></div>
                  <div><span className="text-ink-mid">التاريخ: </span>{result.document.date ?? '—'}</div>
                  <div><span className="text-ink-mid">البيان: </span>{result.document.description ?? '—'}</div>
                  <div><span className="text-ink-mid">صلاحية العرض: </span>{result.inventoryType?.viewAllowed ? 'متاحة' : 'غير متاحة'}</div>
                  <div><span className="text-ink-mid">حالة المعالجة: </span>{result.document.processed || result.document.externalPost ? 'توجد علامة تشخيصية' : 'غير معالج'}</div>
                </div>
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full min-w-[780px] text-sm">
                    <thead className="bg-surface-2 text-ink-mid"><tr>
                      <th className="px-3 py-2 text-start">#</th><th className="px-3 py-2 text-start">الصنف</th>
                      <th className="px-3 py-2 text-start">الوحدة</th><th className="px-3 py-2 text-start">المخزن</th>
                      <th className="px-3 py-2 text-start">كمية الجرد</th><th className="px-3 py-2 text-start">المتاح</th>
                      <th className="px-3 py-2 text-start">الفرق</th>
                    </tr></thead>
                    <tbody>{result.lines.map((line) => <tr key={line.lineNo} className="border-t border-line">
                      <td className="px-3 py-2">{line.lineNo}</td><td className="px-3 py-2"><strong>{line.itemNameAr}</strong><span className="mt-0.5 block text-xs text-ink-mid" dir="ltr">{line.itemCode}</span></td>
                      <td className="px-3 py-2">{line.unitCode}</td><td className="px-3 py-2">{line.warehouseCode}</td>
                      <td className="px-3 py-2">{line.countedQuantity ?? '—'}</td><td className="px-3 py-2">{line.availableQuantity ?? '—'}</td>
                      <td className="px-3 py-2">{line.conversionProven ? (line.differenceQuantity ?? '—') : 'غير محسوب — التحويل غير مثبت'}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </>
            )}
            {result.issues && result.issues.length > 0 && <div className="space-y-2">
              {result.issues.map((issue) => <div key={`${issue.code}-${issue.message}`} className={issue.severity === 'error' ? 'rounded-lg border border-debt-600/40 bg-debt-600/10 p-3 text-sm text-debt-600' : 'rounded-lg border border-hazard-600/40 bg-hazard-600/10 p-3 text-sm text-hazard-700'}>{issue.message}</div>)}
            </div>}
          </div>
        </Card>
      )}
    </div>
  );
}

function InventoryCountItemPicker({ index, itemCode, itemNameAr, onChange }: {
  index: number;
  itemCode: string;
  itemNameAr: string;
  onChange: (itemCode: string, itemNameAr: string) => void;
}) {
  const [search, setSearch] = useState(itemCode ? `${itemCode} — ${itemNameAr}` : '');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (itemCode && itemNameAr) setSearch(`${itemCode} — ${itemNameAr}`);
  }, [itemCode, itemNameAr]);

  const choices = useQuery({
    queryKey: ['oracle-inventory-count-items', debouncedSearch],
    queryFn: () => api<OracleItemsResponse>(`/oracle-test-requests/inventory-counts/lookups/items?search=${encodeURIComponent(debouncedSearch)}&limit=20`),
    enabled: open && debouncedSearch.length >= 2,
    staleTime: 60_000,
  });
  const choose = (item: OracleInventoryItem) => {
    setSearch(`${item.externalItemCode} — ${item.nameAr}`);
    setOpen(false);
    onChange(item.externalItemCode, item.nameAr);
  };

  return <div className="relative space-y-1.5">
    <label htmlFor={`inventory-count-item-${index}`} className="block text-sm font-medium text-concrete-700 dark:text-concrete-200">الصنف {index + 1}</label>
    <div className="relative">
      <Input
        id={`inventory-count-item-${index}`}
        value={search}
        autoComplete="off"
        placeholder="ابحث بكود الصنف أو اسمه"
        className="ps-9"
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(event) => {
          setSearch(event.target.value);
          setOpen(true);
          if (itemCode) onChange('', '');
        }}
      />
      <ChevronDown className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-low transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
    </div>
    {open && debouncedSearch.length >= 2 && <div className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-surface-1 p-1 shadow-xl">
      {choices.isLoading && <p className="px-3 py-3 text-sm text-ink-mid">جاري البحث في الأصناف…</p>}
      {choices.isError && <p className="px-3 py-3 text-sm text-debt-600">تعذر تحميل الأصناف.</p>}
      {!choices.isLoading && choices.data?.items.length === 0 && <p className="px-3 py-3 text-sm text-ink-mid">لا يوجد صنف مطابق.</p>}
      {choices.data?.items.map((item) => <button
        key={item.externalItemCode}
        type="button"
        className="grid w-full grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] items-center gap-3 rounded-lg px-3 py-2 text-right text-sm hover:bg-surface-3"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(item)}
      >
        <bdi className="font-semibold">{item.externalItemCode}</bdi>
        <span className="truncate">{item.nameAr}</span>
      </button>)}
    </div>}
    {search.trim().length > 0 && search.trim().length < 2 && <span className="block text-xs text-ink-mid">اكتب حرفين على الأقل للبحث.</span>}
    {itemCode && <span className="block text-xs text-credit-700"><strong>{itemNameAr}</strong> — <bdi>{itemCode}</bdi></span>}
  </div>;
}
