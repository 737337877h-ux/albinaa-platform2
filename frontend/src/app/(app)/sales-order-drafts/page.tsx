'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Database, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { createRequestId } from '@/lib/request-id';

interface DraftLine {
  id: string;
  lineNo: number;
  itemCode: string;
  itemName?: string | null;
  unitCode: string;
  quantity: string;
  sourcePrice: string;
  sourceWarehouseCode?: string | null;
  proposedWarehouseCode?: string | null;
  originalAvailableQty?: string | null;
  totalAvailableQty: string;
  validationStatus: 'ready' | 'warehouse_review' | 'blocked';
  issues: string[];
}

interface Draft {
  id: string;
  sourceSchema: string;
  sourceOrderNo: string;
  sourceOrderSerial: string;
  sourceOrderDate: string;
  status: string;
  sourceCustomerName?: string | null;
  proposedCustomerCode?: string | null;
  proposedCustomerName?: string | null;
  currencyCode: string;
  sourceAmount: string;
  billDocumentType?: string | null;
  orderKind?: 'cash' | 'credit' | 'other';
  customerBindingStatus?: string;
  sourceApproved?: boolean;
  sourceProcessed?: boolean;
  syncedAt?: string | null;
  validationStatus: 'ready' | 'warning' | 'blocked';
  validationSummary: { issueCodes?: string[]; readyLines?: number; totalLines?: number };
  oracleWriteEnabled: boolean;
  lines: DraftLine[];
}

interface DraftPage { page: number; limit: number; total: number; totalPages: number; items: Draft[]; }
interface SyncResult { mode: 'SELECT_ONLY'; oracleWrite: 'NONE'; sourceSchema: 'IAS20261'; pageCount: number; total: number; created: number; updated: number; blocked: number; }

interface CustomerOption { externalCustomerCode: string; nameAr: string; mobile?: string | null; phone?: string | null; }
interface WarehouseOption { externalWarehouseCode: string; nameAr: string; }
interface ItemUnitOption { code: string; packageSize: string; warehouses: Array<{ code: string; available: string }>; }
interface ItemOption { code: string; name: string; units: ItemUnitOption[]; }
interface NewLine { itemCode: string; itemName: string; unitCode: string; warehouseCode: string; quantity: number; unitPrice: number; units: ItemUnitOption[]; }
interface DryRunResult {
  valid: boolean;
  mode: 'DRY_RUN';
  oracleWrite: 'NONE';
  sourceSchema: 'IAS20261';
  targetSchema: 'IAS20191';
  amount: string;
  validationStatus: 'ready' | 'warning' | 'blocked';
  issueCodes: string[];
  readyLines: number;
  totalLines: number;
  oracleDraftPublication: { enabled: false; reason: string };
}

const issueLabels: Record<string, string> = {
  CUSTOMER_NOT_UNIQUELY_RESOLVED: 'العميل غير محدد',
  CUSTOMER_FUZZY_MATCH_REQUIRES_CONFIRMATION: 'تطابق العميل يحتاج تأكيدًا',
  GENERIC_CUSTOMER_REQUIRES_CONFIRMATION: 'اسم العميل عام ويحتاج تأكيدًا',
  ONE_OR_MORE_LINES_NOT_READY: 'توجد أصناف تحتاج معالجة',
  SOURCE_WAREHOUSE_REASSIGN_REQUIRED: 'يلزم تغيير المستودع',
  INSUFFICIENT_TOTAL_STOCK: 'المخزون الإجمالي غير كافٍ',
  CREDIT_CUSTOMER_CODE_REQUIRED: 'الطلب الآجل يحتاج رقم عميل',
  CUSTOMER_CODE_NOT_IN_PLATFORM: 'رقم العميل غير موجود في دليل المنصة',
  CASH_CUSTOMER_NAME_REQUIRED: 'الطلب النقدي يحتاج اسم العميل',
  ORDER_HAS_NO_POSITIVE_LINES: 'لا توجد أسطر أصناف موجبة في المصدر',
};

function money(value: string, currency: string) {
  return `${new Intl.NumberFormat('ar-YE', { maximumFractionDigits: 2 }).format(Number(value))} ${currency}`;
}

export default function SalesOrderDraftsPage() {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<'all' | 'cash' | 'credit' | 'other'>('all');
  const [listSearch, setListSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [orderKind, setOrderKind] = useState<'cash'|'credit'>('cash');
  const [cashName, setCashName] = useState('');
  const [externalReference, setExternalReference] = useState(createRequestId);
  const [pending, setPending] = useState<{body:string;scope:string}|null>(null);
  const capabilities = useQuery({queryKey:['customer-orders-capabilities'],queryFn:()=>api<{createEnabled:boolean;draftScope:string}>('/customer-orders/capabilities')});
  useEffect(()=>{
    setPending(null);
    const scope=capabilities.data?.draftScope;if(!scope)return;
    const body=localStorage.getItem(`customer-order-pending:${scope}`);
    if(body){try{if(typeof JSON.parse(body).externalReference==='string')setPending({body,scope});}catch{/* Invalid local draft cannot be sent. */}}
  },[capabilities.data?.draftScope]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [unitSearch, setUnitSearch] = useState('');
  const [warehouseSearch, setWarehouseSearch] = useState('');
  const [item, setItem] = useState<ItemOption | null>(null);
  const [unitCode, setUnitCode] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [currencyCode, setCurrencyCode] = useState('YR');
  const [orderDate, setOrderDate] = useState(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Aden', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()));
  const [notes, setNotes] = useState('');
  const [newLines, setNewLines] = useState<NewLine[]>([]);
  const [approvedPayload, setApprovedPayload] = useState('');
  const [checkedPayload, setCheckedPayload] = useState('');
  const drafts = useQuery({
    queryKey: ['sales-order-drafts', page, kind, listSearch],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page), limit: '25', kind });
      if (listSearch.trim()) query.set('search', listSearch.trim());
      return api<DraftPage>(`/sales-order-drafts?${query.toString()}`);
    },
  });
  const customers = useQuery({
    queryKey: ['sales-order-draft-customers', customerSearch],
    queryFn: () => api<CustomerOption[]>(`/sales-order-drafts/catalog/customers?search=${encodeURIComponent(customerSearch)}`),
    enabled: showCreate && customerSearch.trim().length >= 2,
  });
  const items = useQuery({
    queryKey: ['sales-order-draft-items', itemSearch],
    queryFn: () => api<ItemOption[]>(`/sales-order-drafts/catalog/items?search=${encodeURIComponent(itemSearch)}`),
    enabled: showCreate && itemSearch.trim().length >= 2,
  });
  const warehouses = useQuery({
    queryKey: ['sales-order-draft-warehouses'],
    queryFn: () => api<WarehouseOption[]>('/sales-order-drafts/catalog/warehouses'),
    enabled: showCreate,
  });
  const payload = {
    externalReference, orderKind, customerCode: orderKind==='credit'?customer?.externalCustomerCode:undefined,
    customerName: orderKind==='cash'?cashName.trim():undefined, currencyCode, orderDate, notes: notes || undefined,
    lines: newLines.map((line) => ({
      itemCode: line.itemCode, unitCode: line.unitCode, warehouseCode: line.warehouseCode,
      quantity: line.quantity, unitPrice: line.unitPrice,
    })),
  };
  const payloadKey = JSON.stringify(payload);
  const updateNewLine = (index: number, patch: Partial<NewLine>) => {
    setNewLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
    setApprovedPayload('');
    setCheckedPayload('');
  };
  const removeNewLine = (index: number) => {
    setNewLines((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
    setApprovedPayload('');
    setCheckedPayload('');
  };
  const dryRun = useMutation({
    mutationFn: (body:string) => api<DryRunResult>('/customer-orders/dry-run', { method: 'POST', body }),
    onSuccess: (result, body) => {
      setCheckedPayload(body);
      if (!result.valid) {
        setApprovedPayload('');
        toast('فحص الطلب يحتاج معالجة قبل حفظ المسودة', 'err');
        return;
      }
      setApprovedPayload(body);
      toast('نجح فحص الطلب من بيانات IAS20261 دون أي كتابة', 'ok');
    },
    onError: (error) => { setApprovedPayload(''); setCheckedPayload(''); toast(error instanceof Error ? error.message : 'تعذر فحص الطلب', 'err'); },
  });
  const createDraft = useMutation({
    mutationFn: (request:{body:string;scope:string}) => {
      if(request.scope!==capabilities.data?.draftScope)throw new Error('تغيّر حساب الدخول؛ أعد فتح الصفحة');
      localStorage.setItem(`customer-order-pending:${request.scope}`,request.body);
      setPending(request);
      return api<Draft>('/customer-orders', { method: 'POST', body: request.body });
    },
    onSuccess: (result,request) => {
      localStorage.removeItem(`customer-order-pending:${request.scope}`);setPending(null);setExternalReference(createRequestId());setCashName('');
      toast(`تم حفظ طلب Oracle رقم ${result.sourceOrderNo} — غير معتمد`, 'ok');
      setShowCreate(false); setCustomer(null); setCustomerSearch(''); setNewLines([]); setNotes(''); setApprovedPayload(''); setCheckedPayload('');
      drafts.refetch();
    },
    onError: (error,request) => {
      if(error instanceof ApiError && error.status===400){localStorage.removeItem(`customer-order-pending:${request.scope}`);setPending(null);setApprovedPayload('');}
      toast(error instanceof Error ? error.message : 'تعذر تأكيد الحفظ؛ أعد المحاولة بنفس الطلب', 'err');
    },
  });
  const syncOracle = useMutation({
    mutationFn: () => api<SyncResult>('/sales-order-drafts/sync-oracle', { method: 'POST' }),
    onSuccess: (result) => {
      toast(`تمت قراءة ${result.total} طلبًا من IAS20261: ${result.created} جديد و${result.updated} محدث`, 'ok');
      setPage(1);
      drafts.refetch();
    },
    onError: (error) => toast(error instanceof Error ? error.message : 'تعذرت مزامنة طلبات Oracle', 'err'),
  });
  const processDraft = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api<Draft>(`/sales-order-drafts/${id}/process`, {
      method: 'POST', body: JSON.stringify({ status }),
    }),
    onSuccess: () => { toast('تم تحديث حالة مراجعة الطلب داخل المنصة فقط', 'ok'); drafts.refetch(); },
    onError: (error) => toast(error instanceof Error ? error.message : 'تعذرت معالجة الطلب', 'err'),
  });
  const rows = drafts.data?.items ?? [];
  const blocked = rows.filter((draft) => draft.validationStatus === 'blocked').length;
  const totalLines = rows.reduce((sum, draft) => sum + draft.lines.length, 0);
  const readyLines = rows.reduce((sum, draft) => sum + draft.lines.filter((line) => line.validationStatus === 'ready').length, 0);

  return <div className="space-y-5">
    <PageHeader title="طلبات العملاء" action={<div className="flex flex-wrap gap-2"><Button variant="secondary" loading={syncOracle.isPending} onClick={() => syncOracle.mutate()}><Database className="h-4 w-4" />مزامنة Oracle</Button><Button disabled={!capabilities.data?.createEnabled||Boolean(pending)} onClick={() => setShowCreate((value) => !value)}><Plus className="h-4 w-4" />طلب جديد</Button></div>} />
    {pending && <Card><div className="space-y-3 p-4"><strong>طلب بانتظار تأكيد الحفظ</strong><p>أعد إرسال الطلب نفسه لاسترجاع رقمه دون إنشاء نسخة أخرى.</p><Button loading={createDraft.isPending} disabled={!capabilities.data?.createEnabled} onClick={()=>createDraft.mutate(pending)}>استكمال تأكيد الطلب</Button></div></Card>}
    <Card className="border-credit-700/30"><div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div><p className="font-bold">طلبات العملاء ARST003 — Oracle 2026</p><p className="text-sm text-ink-mid">إنشاء طلب نقدي أو آجل غير معتمد. النقدي بالاسم، والآجل برقم العميل مع فحص الائتمان. تغيير حالة المتابعة للطلبات السابقة يخص المنصة فقط.</p></div>
      <Badge tone="credit"><ShieldCheck className="h-4 w-4" />فحص بلا كتابة</Badge>
    </div></Card>

    <div className="grid gap-3 md:grid-cols-3">
      <Card><div className="p-4"><span className="text-sm text-ink-mid">الطلبات المطابقة</span><strong className="mt-2 block text-3xl">{drafts.data?.total ?? 0}</strong></div></Card>
      <Card><div className="p-4"><span className="text-sm text-ink-mid">بانتظار المعالجة</span><strong className="mt-2 block text-3xl text-hazard-700">{blocked}</strong></div></Card>
      <Card><div className="p-4"><span className="text-sm text-ink-mid">الأسطر الجاهزة</span><strong className="mt-2 block text-3xl">{readyLines} / {totalLines}</strong></div></Card>
    </div>

    <Card><div className="grid gap-3 p-4 md:grid-cols-[1fr_auto]">
      <Input value={listSearch} onChange={(event) => { setListSearch(event.target.value); setPage(1); }} placeholder="ابحث برقم الطلب أو رقم العميل أو الاسم" />
      <div className="flex flex-wrap gap-2">{([
        ['all', 'الكل'], ['cash', 'نقدي'], ['credit', 'آجل'], ['other', 'أخرى'],
      ] as const).map(([value, label]) => <Button key={value} variant={kind === value ? 'primary' : 'secondary'} onClick={() => { setKind(value); setPage(1); }}>{label}</Button>)}</div>
    </div></Card>

    {showCreate && <Card>
      <CardHeader title="إنشاء طلب عميل في Oracle" action={<Badge tone="credit">غير معتمد</Badge>} />
      <fieldset disabled={Boolean(pending)||createDraft.isPending} className="space-y-4 p-4">
        <Field label="نوع الطلب"><Select value={orderKind} onChange={e=>setOrderKind(e.target.value as 'cash'|'credit')}><option value="cash">نقدي</option><option value="credit">آجل</option></Select></Field>
        {orderKind==='cash' && <Field label="اسم العميل النقدي"><Input value={cashName} onChange={e=>setCashName(e.target.value)} /></Field>}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="تاريخ الطلب"><Input type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} /></Field>
          <Field label="العملة"><Select value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value)}><option value="YR">ريال يمني</option><option value="SR">ريال سعودي</option><option value="$">دولار</option></Select></Field>
        </div>

        {orderKind==='credit' && <details className="rounded-lg border border-line bg-surface-2" open={!customer}>
          <summary className="cursor-pointer list-none p-4 font-bold">العميل <span className="font-normal text-ink-mid">— {customer ? `${customer.nameAr} (${customer.externalCustomerCode})` : 'لم يُحدد بعد'}</span></summary>
          <div className="border-t border-line p-4">
            <SearchPicker
              ariaLabel="العميل"
              valueLabel={customer ? `${customer.nameAr} — ${customer.externalCustomerCode}` : undefined}
              search={customerSearch}
              onSearch={setCustomerSearch}
              options={customers.data ?? []}
              loading={customers.isFetching}
              placeholder="اختر العميل"
              searchPlaceholder="ابحث داخل قائمة العملاء بالاسم أو الرقم أو الهاتف"
              getKey={(row) => row.externalCustomerCode}
              optionText={(row) => `${row.nameAr} ${row.externalCustomerCode} ${row.mobile ?? ''} ${row.phone ?? ''}`}
              renderOption={(row) => <><strong>{row.nameAr}</strong><span className="mr-2 text-xs text-ink-mid" dir="ltr">{row.externalCustomerCode}</span></>}
              onSelect={(row) => { setCustomer(row); setCustomerSearch(''); }}
            />
          </div>
        </details>}

        <details className="rounded-lg border border-line bg-surface-2">
          <summary className="cursor-pointer list-none p-4 font-bold">إضافة صنف <span className="font-normal text-ink-mid">— {item ? `${item.name} (${item.code})` : 'افتح للبحث'}</span></summary>
          <div className="space-y-4 border-t border-line p-4">
            <SearchPicker
              ariaLabel="الصنف"
              valueLabel={item ? `${item.name} — ${item.code}` : undefined}
              search={itemSearch}
              onSearch={setItemSearch}
              options={items.data ?? []}
              loading={items.isFetching}
              placeholder="اختر الصنف"
              searchPlaceholder="ابحث داخل قائمة الأصناف بالاسم أو الرقم"
              getKey={(row) => row.code}
              optionText={(row) => `${row.name} ${row.code}`}
              renderOption={(row) => <><strong>{row.name}</strong><span className="mr-2 text-xs text-ink-mid" dir="ltr">{row.code}</span></>}
              onSelect={(row) => { setItem(row); setItemSearch(''); setUnitCode(row.units[0]?.code ?? ''); setWarehouseCode(row.units[0]?.warehouses[0]?.code ?? ''); setUnitSearch(''); setWarehouseSearch(''); }}
            />
            {item && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <Field label="الوحدة"><SearchPicker ariaLabel="الوحدة" valueLabel={unitCode || undefined} search={unitSearch} onSearch={setUnitSearch} options={item.units} placeholder="اختر الوحدة" searchPlaceholder="ابحث داخل قائمة الوحدات" getKey={(unit) => unit.code} optionText={(unit) => `${unit.code} ${unit.packageSize}`} renderOption={(unit) => <span>{unit.code} — حجم العبوة {unit.packageSize}</span>} onSelect={(unit) => { setUnitCode(unit.code); setWarehouseCode(unit.warehouses[0]?.code ?? ''); setUnitSearch(''); }} /></Field>
              <Field label="المستودع"><SearchPicker ariaLabel="المستودع" valueLabel={(warehouses.data ?? []).find((row) => row.externalWarehouseCode === warehouseCode)?.nameAr || warehouseCode || undefined} search={warehouseSearch} onSearch={setWarehouseSearch} options={warehouses.data ?? []} loading={warehouses.isFetching} placeholder="اختر المستودع" searchPlaceholder="ابحث داخل قائمة المستودعات" getKey={(row) => row.externalWarehouseCode} optionText={(row) => `${row.externalWarehouseCode} ${row.nameAr}`} renderOption={(row) => <span>{row.externalWarehouseCode} — {row.nameAr}</span>} onSelect={(row) => { setWarehouseCode(row.externalWarehouseCode); setWarehouseSearch(''); }} /></Field>
              <Field label="الكمية"><Input type="number" min="0.000001" step="any" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></Field>
              <Field label="سعر الوحدة"><Input type="number" min="0" step="any" value={unitPrice} onChange={(event) => setUnitPrice(Number(event.target.value))} /></Field>
              <div className="flex items-end"><Button type="button" className="w-full" disabled={!unitCode || !warehouseCode || quantity <= 0} onClick={() => { setNewLines((rows) => [...rows, { itemCode: item.code, itemName: item.name, unitCode, warehouseCode, quantity, unitPrice, units: item.units }]); setItem(null); setItemSearch(''); setQuantity(1); setUnitPrice(0); setApprovedPayload(''); setCheckedPayload(''); }}><Plus className="h-4 w-4" />إضافة الصنف</Button></div>
            </div>}
          </div>
        </details>

        {newLines.map((line, index) => <details key={`${line.itemCode}-${index}`} className="rounded-lg border border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3"><strong>الصنف {index + 1}: {line.itemName}</strong><span className="text-sm text-ink-mid">{line.quantity} {line.unitCode} • {line.warehouseCode}</span></summary>
          <div className="grid gap-3 border-t border-line p-3 text-sm md:grid-cols-2 xl:grid-cols-6">
            <div><span className="block text-ink-mid">رمز الصنف</span><strong dir="ltr">{line.itemCode}</strong></div>
            <Field label="الوحدة"><Select value={line.unitCode} onChange={(event) => { const nextUnit = line.units.find((row) => row.code === event.target.value); updateNewLine(index, { unitCode: event.target.value, warehouseCode: nextUnit?.warehouses[0]?.code ?? line.warehouseCode }); }}>{line.units.map((row) => <option key={row.code} value={row.code}>{row.code}</option>)}</Select></Field>
            <Field label="المستودع"><Select value={line.warehouseCode} onChange={(event) => updateNewLine(index, { warehouseCode: event.target.value })}>{(warehouses.data ?? []).map((row) => <option key={row.externalWarehouseCode} value={row.externalWarehouseCode}>{row.externalWarehouseCode} — {row.nameAr}</option>)}</Select></Field>
            <Field label="الكمية"><Input type="number" min="0.000001" step="any" value={line.quantity} onChange={(event) => updateNewLine(index, { quantity: Number(event.target.value) })} /></Field>
            <Field label="سعر الوحدة"><Input type="number" min="0" step="any" value={line.unitPrice} onChange={(event) => updateNewLine(index, { unitPrice: Number(event.target.value) })} /></Field>
            <div className="flex items-end justify-end"><Button type="button" variant="ghost" onClick={() => removeNewLine(index)}><Trash2 className="h-4 w-4 text-debt-600" />حذف الصنف</Button></div>
          </div>
        </details>)}
        <Field label="ملاحظات"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></Field>
        {dryRun.isPending && <div role="status" className="rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-mid">جار فحص العميل والأصناف والمخزون من IAS20261 دون كتابة…</div>}
        {dryRun.data && checkedPayload === payloadKey && <div className={`rounded-lg border p-3 text-sm ${dryRun.data.valid ? 'border-credit-700/30 text-credit-700' : 'border-debt-600/30 text-debt-600'}`}><strong>{dryRun.data.valid ? 'نجح فحص الطلب' : 'الطلب يحتاج معالجة'}</strong> — {dryRun.data.readyLines} من {dryRun.data.totalLines} أصناف جاهزة، والإجمالي {money(dryRun.data.amount, currencyCode)}. لم تُجرَ أي كتابة.</div>}
        <div className="rounded-lg border border-line p-3 text-sm">يُحفظ الطلب في Oracle بحالة غير معتمد. يلزم اجتياز الفحص قبل الحفظ.</div>
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>إلغاء</Button><Button type="button" variant="secondary" loading={dryRun.isPending} disabled={!capabilities.data?.createEnabled || (orderKind==='credit'?!customer:!cashName.trim()) || newLines.length === 0 || !orderDate} onClick={() => dryRun.mutate(payloadKey)}>فحص الطلب</Button><Button type="button" loading={createDraft.isPending} disabled={!capabilities.data?.createEnabled || approvedPayload !== payloadKey} onClick={() => capabilities.data && createDraft.mutate({body:payloadKey,scope:capabilities.data.draftScope})}><ShieldCheck className="h-4 w-4" />حفظ في Oracle</Button></div>
      </fieldset>
    </Card>}

    <Card>
      <CardHeader title="طلبات المراجعة" action={<Button variant="secondary" loading={drafts.isFetching} onClick={() => drafts.refetch()}><RefreshCw className="h-4 w-4" />تحديث</Button>} />
      {drafts.isError && <div className="m-4 rounded-lg border border-debt-600/30 p-4 text-debt-600">تعذر تحميل المسودات.</div>}
      {!drafts.isLoading && rows.length === 0 && <div className="p-8 text-center text-ink-mid">لا توجد مسودات حتى الآن.</div>}
      <div className="divide-y divide-line">
        {rows.map((draft) => {
          const issueCodes = draft.validationSummary?.issueCodes ?? [];
          return <details key={draft.id} className="group p-4">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3"><ClipboardList className="h-5 w-5 text-brand" /><div><strong>طلب {draft.sourceOrderNo}</strong><p className="text-xs text-ink-mid">{draft.sourceCustomerName || 'عميل غير محدد'} — {new Date(draft.sourceOrderDate).toLocaleDateString('ar-YE')}</p></div></div>
              <div className="flex flex-wrap items-center gap-2"><Badge tone={draft.orderKind === 'credit' ? 'hazard' : draft.orderKind === 'cash' ? 'credit' : 'neutral'}>{draft.orderKind === 'credit' ? 'آجل' : draft.orderKind === 'cash' ? 'نقدي' : 'أخرى'}</Badge><strong>{money(draft.sourceAmount, draft.currencyCode)}</strong><Badge tone={draft.validationStatus === 'ready' ? 'credit' : 'hazard'}>{draft.validationStatus === 'ready' ? 'جاهز' : 'بانتظار المراجعة'}</Badge></div>
            </summary>
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 rounded-lg border border-line bg-surface-2 p-3 text-sm md:grid-cols-4">
                <div><span className="block text-ink-mid">مرجع المصدر</span><strong dir="ltr">{draft.sourceSchema} / {draft.sourceOrderSerial}</strong></div>
                <div><span className="block text-ink-mid">العميل</span><strong>{draft.proposedCustomerName || 'يحتاج تحديدًا'}{draft.proposedCustomerCode ? ` — ${draft.proposedCustomerCode}` : ''}</strong></div>
                <div><span className="block text-ink-mid">حالة المصدر</span><strong>{draft.sourceApproved ? 'معتمد' : 'غير معتمد'} / {draft.sourceProcessed ? 'معالج' : 'غير معالج'}</strong></div>
                <div><span className="block text-ink-mid">حالة الربط</span><strong>{draft.customerBindingStatus === 'cash_name_only' ? 'نقدي بالاسم' : draft.customerBindingStatus === 'linked_by_code' ? 'مرتبط برقم العميل' : draft.customerBindingStatus || 'غير مفحوص'}</strong></div>
              </div>
              {issueCodes.length > 0 && <div className="flex flex-wrap gap-2">{issueCodes.map((code) => <Badge key={code} tone="hazard"><AlertTriangle className="h-3.5 w-3.5" />{issueLabels[code] ?? code}</Badge>)}</div>}
              <div className="space-y-2">{draft.lines.map((line) => <details key={line.id} className="rounded-lg border border-line">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-3"><strong>الصنف {line.lineNo}: {line.itemName || line.itemCode}</strong><span className="flex items-center gap-2 text-sm text-ink-mid">{line.quantity} {line.unitCode}{line.validationStatus === 'ready' ? <Badge tone="credit"><CheckCircle2 className="h-3.5 w-3.5" />جاهز</Badge> : <Badge tone="hazard">{line.validationStatus === 'warehouse_review' ? 'تغيير مستودع' : 'غير متوفر'}</Badge>}</span></summary>
                <div className="grid gap-3 border-t border-line p-3 text-sm md:grid-cols-4">
                  <div><span className="block text-ink-mid">رمز الصنف</span><strong dir="ltr">{line.itemCode}</strong></div>
                  <div><span className="block text-ink-mid">المستودع</span><strong>{line.sourceWarehouseCode || '—'}{line.proposedWarehouseCode && line.proposedWarehouseCode !== line.sourceWarehouseCode ? ` ← ${line.proposedWarehouseCode}` : ''}</strong></div>
                  <div><span className="block text-ink-mid">المتاح</span><strong>{line.totalAvailableQty}</strong></div>
                  <div><span className="block text-ink-mid">السعر</span><strong>{money(line.sourcePrice, draft.currencyCode)}</strong></div>
                </div>
              </details>)}</div>
              <div className="flex flex-wrap justify-end gap-2">
                {draft.status !== 'ready_for_approval' && <Button variant="secondary" disabled={draft.validationStatus === 'blocked'} loading={processDraft.isPending} onClick={() => processDraft.mutate({ id: draft.id, status: 'ready_for_approval' })}>جاهز للمراجعة</Button>}
                {draft.status !== 'archived' && <Button variant="ghost" loading={processDraft.isPending} onClick={() => processDraft.mutate({ id: draft.id, status: 'archived' })}>إغلاق متابعة الطلب</Button>}
              </div>
            </div>
          </details>;
        })}
      </div>
      {(drafts.data?.totalPages ?? 0) > 1 && <div className="flex items-center justify-between border-t border-line p-4"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</Button><span className="text-sm text-ink-mid">صفحة {page} من {drafts.data?.totalPages}</span><Button variant="secondary" disabled={page >= (drafts.data?.totalPages ?? 1)} onClick={() => setPage((value) => value + 1)}>التالي</Button></div>}
    </Card>
  </div>;
}

function SearchPicker<T,>({
  ariaLabel, valueLabel, search, onSearch, options, loading = false, placeholder, searchPlaceholder,
  getKey, optionText, renderOption, onSelect,
}: {
  ariaLabel: string;
  valueLabel?: string;
  search: string;
  onSearch: (value: string) => void;
  options: T[];
  loading?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  getKey: (option: T) => string;
  optionText: (option: T) => string;
  renderOption: (option: T) => ReactNode;
  onSelect: (option: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const normalized = search.trim().toLocaleLowerCase('ar');
  const filtered = normalized ? options.filter((option) => optionText(option).toLocaleLowerCase('ar').includes(normalized)) : options;
  return <div className="relative">
    <Button type="button" variant="secondary" className="w-full justify-between" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span className="truncate">{valueLabel || placeholder}</span><Search className="h-4 w-4 shrink-0" />
    </Button>
    {open && <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface-1 shadow-lg">
      <div className="border-b border-line p-2"><Input autoFocus aria-label={`بحث ${ariaLabel}`} value={search} onChange={(event) => onSearch(event.target.value)} placeholder={searchPlaceholder} /></div>
      <div role="listbox" aria-label={`قائمة ${ariaLabel}`} className="max-h-64 overflow-y-auto">
        {loading && <div className="p-3 text-sm text-ink-mid">جار تحميل القائمة…</div>}
        {!loading && filtered.length === 0 && <div className="p-3 text-sm text-ink-mid">لا توجد نتائج مطابقة.</div>}
        {filtered.map((option) => <button type="button" role="option" aria-selected={valueLabel === optionText(option)} key={getKey(option)} className="block w-full border-b border-line px-3 py-2 text-right last:border-0 hover:bg-surface-2" onClick={() => { onSelect(option); setOpen(false); }}>{renderOption(option)}</button>)}
      </div>
    </div>}
  </div>;
}
