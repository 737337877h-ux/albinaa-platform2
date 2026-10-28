'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { voucherCounterAmount } from '@/lib/voucher-conversion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRightLeft, ChevronDown, Eye, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { PermissionNotice } from '@/components/ui/data-state';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { api, apiFileBlob } from '@/lib/api';
import { createRequestId } from '@/lib/request-id';
import { useCan } from '@/lib/auth';
import {
  accountLinkKey, allowedPartyCurrencies, automaticCollector, filterParties,
  oracleCurrencyLabel, partyCategoryLabels, resolvePartyLink,
  type OracleParty, type OracleRequestCatalog, type PartyCategory,
} from '@/lib/oracle-test-requests';
import type {
  OracleInventoryItem, OracleItemDetail, OracleItemsResponse, OracleWarehousesResponse,
} from '@/lib/oracle-inventory';

type Tab = 'purchase' | 'voucher' | 'journal' | 'inventory';
type Currency = { code: string; nameAr: string; rate: string; local: boolean };
type CurrencyCatalog = { schema: string; currencies: Currency[] };
type DryRunResult = {
  valid?: boolean; issues?: Array<{ code?: string; message?: string }>;
  localAmount?: number; counterpartyLocalAmount?: number; localBalance?: number; localCurrency?: string;
  saveAllowed?: boolean; saveBlockedReason?: string;
} & Record<string, unknown>;
type PartyLine = { id: string; category: PartyCategory; partyCode: string; accountKey: string; currencyCode: string; amount: string; description: string };
type JournalLine = PartyLine & { direction: 'debit' | 'credit'; currencyCode: string };
type PurchaseLine = { id: string; itemCode: string; itemName: string; unitCode: string; quantity: string };
type PurchaseState = { warehouseCode: string; notes: string; lines: PurchaseLine[] };
type CreatedRequest = {
  kind: 'purchase' | 'receipt' | 'payment' | 'journal' | 'inventory_transfer' | 'inventory_count';
  requestNo: string; requestSerial: string; description: string | null;
  status: 'pending_approval' | 'approved' | 'rejected' | 'inactive' | 'cancelled' | 'unknown';
  statusLabel?: string; statusVerified?: boolean; finalReceiptId?: string | null;
  createdAt: string | null;
  approval: null | { level: number; code: number | null; userId: string | null; date: string | null; description: string | null };
  attachment?: { id: string; fileName: string; previewPath: string; uploadedAt: string };
};
type CreatedRequestsResult = {
  mode: 'SELECT_ONLY'; oracleWrite: 'NONE'; schemas: string[]; partial: boolean;
  warnings: Array<{ kind: string; schema: string; message: string }>;
  items: CreatedRequest[];
};
type FinancialAdjustmentJournalDraft = {
  id: string;
  journalStatus: string | null;
  customer: { id: string; name: string; externalCustomerCode: string };
  journalDraft: {
    externalReference: string;
    description: string;
    lines: Array<{
      direction: 'debit' | 'credit'; accountCode: string; analyticalAccountCode?: string;
      currencyCode: string; amount: number; description: string;
    }>;
  };
};

const requestLabels: Record<CreatedRequest['kind'], string> = {
  purchase: 'طلب شراء', receipt: 'سند قبض', payment: 'سند صرف', journal: 'قيد يومي', inventory_transfer: 'تحويل مخزني', inventory_count: 'جرد مخزون',
};
const statusLabels: Record<CreatedRequest['status'], string> = {
  pending_approval: 'بانتظار الاعتماد', approved: 'معتمد', rejected: 'مرفوض', inactive: 'موقوف',
  cancelled: 'ملغي', unknown: 'تعذر التحقق من حالة الطلب',
};

const newId = createRequestId;
const actionError = (error: Error, action: string) => error.message === 'تعذّر الاتصال بالخادم'
  ? `تعذر ${action} بسبب انقطاع الاتصال بالخادم. بقيت بياناتك في الصفحة؛ تحقق من الشبكة ثم أعد المحاولة.`
  : error.message;
const initialPurchase: PurchaseState = {
  warehouseCode: '', notes: '',
  lines: [{ id: 'purchase-1', itemCode: '', itemName: '', unitCode: '', quantity: '1' }],
};
const initialInventory: PurchaseState = {
  warehouseCode: '', notes: 'جرد من منصة البناء الراقي',
  lines: [{ id: 'inventory-1', itemCode: '', itemName: '', unitCode: '', quantity: '0' }],
};
const initialVoucher = {
  kind: 'receipt' as 'receipt' | 'payment', paymentMethod: 'cash' as 'cash' | 'bank_transfer',
  currencyCode: '', amount: '', cashOrBankNo: '', description: '', recipientName: '', referenceNo: '', noticeNo: '', collectorCode: '',
  lines: [{ id: 'voucher-1', category: 'customers' as PartyCategory, partyCode: '', accountKey: '', currencyCode: '', amount: '', description: '' }],
};
const initialJournal = {
  description: '', referenceNo: '',
  lines: [
    { id: 'journal-1', direction: 'debit' as const, currencyCode: '', category: 'other' as PartyCategory, partyCode: '', accountKey: '', amount: '', description: '' },
    { id: 'journal-2', direction: 'credit' as const, currencyCode: '', category: 'other' as PartyCategory, partyCode: '', accountKey: '', amount: '', description: '' },
  ],
};

export default function OracleTestRequestsPage() {
  const can = useCan();
  const searchParams = useSearchParams();
  const financialAdjustmentId = searchParams.get('financialAdjustmentId');
  const loadedFinancialAdjustment = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const canRead = (kind: CreatedRequest['kind']) => can(kind === 'inventory_transfer' ? 'inventory_transfers.read' : `oracle_test_requests.${kind}.read`);
  const purchaseCreate = can('oracle_test_requests.purchase.create');
  const receiptCreate = can('oracle_test_requests.receipt.create');
  const paymentCreate = can('oracle_test_requests.payment.create');
  const journalCreate = can('oracle_test_requests.journal.create');
  const inventoryCreate = can('oracle_test_requests.inventory_count.create');
  const canCreate = (kind: Exclude<CreatedRequest['kind'], 'inventory_transfer'>) => ({
    purchase: purchaseCreate, receipt: receiptCreate, payment: paymentCreate, journal: journalCreate, inventory_count: inventoryCreate,
  })[kind];
  const createTabs = useMemo<Tab[]>(() => [
    ...(purchaseCreate ? ['purchase' as const] : []),
    ...(receiptCreate || paymentCreate ? ['voucher' as const] : []),
    ...(journalCreate ? ['journal' as const] : []),
    ...(inventoryCreate ? ['inventory' as const] : []),
  ], [purchaseCreate, receiptCreate, paymentCreate, journalCreate, inventoryCreate]);
  const canCreateAny = createTabs.length > 0;
  const allowed = canCreateAny || (['purchase', 'receipt', 'payment', 'journal', 'inventory_transfer', 'inventory_count'] as const).some(canRead);
  const [tab, setTab] = useState<Tab>('purchase');
  const [purchase, setPurchase] = useState(initialPurchase);
  const [voucher, setVoucher] = useState(initialVoucher);
  const [journal, setJournal] = useState(initialJournal);
  const [inventory, setInventory] = useState(initialInventory);
  const [reference, setReference] = useState(createRequestId);
  const [approvedPayload, setApprovedPayload] = useState('');
  const [online, setOnline] = useState(true);
  const invalidate = () => setApprovedPayload('');
  const previewAttachment = async (item: CreatedRequest) => {
    if (!item.attachment) return;
    try {
      const blob = await apiFileBlob(item.attachment.previewPath);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذر فتح صورة الإيصال', 'err');
    }
  };

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  useEffect(() => {
    if (createTabs.length && !createTabs.includes(tab)) setTab(createTabs[0]);
  }, [createTabs, tab]);
  useEffect(() => {
    if (voucher.kind === 'receipt' && !receiptCreate && paymentCreate) setVoucher((state) => ({ ...state, kind: 'payment' }));
    if (voucher.kind === 'payment' && !paymentCreate && receiptCreate) setVoucher((state) => ({ ...state, kind: 'receipt' }));
  }, [voucher.kind, receiptCreate, paymentCreate]);

  const created = useQuery<CreatedRequestsResult>({
    queryKey: ['oracle-test-requests-created'],
    queryFn: () => api('/oracle-test-requests/created'),
    enabled: allowed,
    refetchInterval: 30_000,
  });

  const currencies = useQuery<CurrencyCatalog>({
    queryKey: ['oracle-test-currencies'], queryFn: () => api('/oracle-test-requests/currencies'), enabled: canCreateAny,
  });
  const catalog = useQuery<OracleRequestCatalog>({
    queryKey: ['oracle-test-request-catalog', voucher.kind],
    queryFn: () => api(`/oracle-test-requests/catalog?purpose=${voucher.kind}`),
    enabled: canCreateAny && (tab === 'voucher' || tab === 'journal'),
  });
  const financialAdjustment = useQuery<FinancialAdjustmentJournalDraft>({
    queryKey: ['financial-adjustment-journal-draft', financialAdjustmentId],
    queryFn: () => api(`/customers/financial-adjustment-requests/${financialAdjustmentId}/journal-draft`),
    enabled: journalCreate && Boolean(financialAdjustmentId),
  });
  const purchaseWarehouses = useQuery<OracleWarehousesResponse>({
    queryKey: ['oracle-test-purchase-warehouses'],
    queryFn: () => api('/oracle-test-requests/purchases/lookups/warehouses'),
    enabled: (purchaseCreate && tab === 'purchase') || (inventoryCreate && tab === 'inventory'),
    staleTime: 5 * 60_000,
  });

  const currencyOptions = currencies.data?.currencies ?? [];
  const singleVoucherLine = voucher.lines.length === 1 ? voucher.lines[0] : undefined;
  const voucherConversion = singleVoucherLine ? voucherCounterAmount(voucher.amount,
    currencyOptions.find(c => c.code === voucher.currencyCode),
    currencyOptions.find(c => c.code === singleVoucherLine.currencyCode)) : null;
  const voucherConversionKey = JSON.stringify([voucher.amount, voucher.currencyCode, singleVoucherLine?.id,
    singleVoucherLine?.currencyCode, voucherConversion?.amount, voucherConversion?.rate]);
  const lastVoucherConversion = useRef('');
  useEffect(() => {
    if (!singleVoucherLine || lastVoucherConversion.current === voucherConversionKey) return;
    lastVoucherConversion.current = voucherConversionKey;
    const nextAmount = voucherConversion?.amount ?? '';
    if (singleVoucherLine.amount === nextAmount) return;
    setVoucher(current => current.lines.length === 1 ? { ...current, lines: [{ ...current.lines[0], amount: nextAmount }] } : current);
    setApprovedPayload('');
  }, [singleVoucherLine, voucherConversionKey, voucherConversion?.amount]);
  const locations = voucher.paymentMethod === 'cash' ? catalog.data?.cashboxes ?? [] : catalog.data?.banks ?? [];
  const selectedLocation = locations.find((item) => item.code === voucher.cashOrBankNo);
  const locationCurrencyOptions = selectedLocation
    ? currencyOptions.filter((item) => selectedLocation.currencyCodes.includes(item.code))
    : currencyOptions;

  const voucherResolved = useMemo(() => voucher.lines.map((line) => {
    const party = catalog.data?.parties[line.category]?.find((item) => item.code === line.partyCode);
    return { line, party, link: resolvePartyLink(party, line.accountKey) };
  }), [voucher.lines, catalog.data]);
  const assignedCollector = automaticCollector(voucherResolved.map((item) => item.party));
  const selectedCollector = assignedCollector
    ?? catalog.data?.collectors.find((item) => item.code === voucher.collectorCode);
  const automaticReceiptDescription = useMemo(() => {
    if (voucher.kind !== 'receipt') return '';
    const customerName = voucherResolved.map((item) => item.party?.nameAr).filter(Boolean).join('، ') || 'العميل';
    const referenceNo = (voucher.referenceNo || voucher.noticeNo).trim();
    const referenceText = referenceNo ? ` رقم ${referenceNo}` : '';
    if (voucher.paymentMethod === 'cash') {
      return `لكم إيداع نقدًا${referenceText} من الأخ ${customerName} دفعة من الحساب`;
    }
    const locationName = selectedLocation?.nameAr || 'الحساب البنكي';
    const isWallet = ['203', '205', '207'].includes(String(selectedLocation?.code ?? ''));
    return isWallet
      ? `لكم إيداع عبر ${locationName}${referenceText} من الأخ ${customerName} دفعة من الحساب`
      : `لكم حوالة${referenceText} من الأخ ${customerName} دفعة من الحساب`;
  }, [voucher.kind, voucher.paymentMethod, voucher.referenceNo, voucher.noticeNo, voucherResolved, selectedLocation]);

  useEffect(() => {
    const prepared = financialAdjustment.data;
    if (!prepared || !catalog.data || loadedFinancialAdjustment.current === prepared.id) return;
    const resolvePreparedLine = (line: FinancialAdjustmentJournalDraft['journalDraft']['lines'][number]) => {
      for (const [category, parties] of Object.entries(catalog.data!.parties) as [PartyCategory, OracleParty[]][]) {
        for (const party of parties) {
          const link = party.linkedAccounts.find((candidate) => candidate.accountCode === line.accountCode
            && (!line.analyticalAccountCode || candidate.analyticalAccountCode === line.analyticalAccountCode));
          if (link) return {
            id: newId(), direction: line.direction, currencyCode: line.currencyCode,
            category, partyCode: party.code, accountKey: accountLinkKey(link),
            amount: String(line.amount), description: line.description,
          };
        }
      }
      return {
        id: newId(), direction: line.direction, currencyCode: line.currencyCode,
        category: 'other' as PartyCategory, partyCode: '', accountKey: '',
        amount: String(line.amount), description: line.description,
      };
    };
    setJournal({
      description: prepared.journalDraft.description,
      referenceNo: prepared.journalDraft.externalReference,
      lines: prepared.journalDraft.lines.map(resolvePreparedLine),
    });
    setReference(prepared.id);
    setTab('journal');
    setApprovedPayload('');
    loadedFinancialAdjustment.current = prepared.id;
  }, [catalog.data, financialAdjustment.data]);

  const payload = useMemo(() => {
    if (tab === 'purchase') return {
      externalReference: `platform-purchase:${reference}`, warehouseCode: purchase.warehouseCode,
      requestSide: 'منصة البناء الراقي', notes: purchase.notes || 'طلب شراء تجريبي من منصة البناء الراقي',
      lines: purchase.lines.map((line) => ({ itemCode: line.itemCode, unitCode: line.unitCode, quantity: Number(line.quantity) })),
    };
    if (tab === 'inventory') return {
      externalReference: `platform-inventory:${reference}`, inventoryType: 1,
      warehouseCode: inventory.warehouseCode, description: inventory.notes || 'جرد من منصة البناء الراقي',
      lines: inventory.lines.map((line) => ({ itemCode: line.itemCode, unitCode: line.unitCode, countedQuantity: Number(line.quantity) })),
    };
    if (tab === 'voucher') return {
      kind: voucher.kind, paymentMethod: voucher.paymentMethod,
      externalReference: `platform-voucher:${reference}`,
      currencyCode: voucher.currencyCode,
      amount: Number(voucher.amount),
      cashOrBankNo: Number(voucher.cashOrBankNo),
      description: voucher.description.trim() || automaticReceiptDescription,
      referenceNo: voucher.referenceNo || null,
      noticeNo: voucher.paymentMethod === 'bank_transfer' ? voucher.noticeNo || null : null,
      collectorNo: voucher.kind === 'receipt' && selectedCollector ? Number(selectedCollector.code) : null,
      commissionPercent: voucher.kind === 'receipt' ? selectedCollector?.commissionPercent ?? null : null,
      recipientName: voucher.recipientName.trim() || (voucher.kind === 'payment'
        ? voucherResolved.map((item) => item.party?.nameAr).filter(Boolean).join('، ') : null),
      lines: voucherResolved.map(({ line, link }) => ({
        currencyCode: line.currencyCode,
        amount: Number(line.amount), accountCode: link?.accountCode || '',
        analyticalAccountCode: link?.analyticalAccountCode || '', analyticalType: link?.analyticalType || 0,
        description: line.description || voucher.description.trim() || automaticReceiptDescription,
      })),
    };
    return {
      externalReference: `platform-journal:${reference}`, description: journal.description,
      referenceNo: journal.referenceNo || null,
      lines: journal.lines.map((line) => {
        const party = catalog.data?.parties[line.category]?.find((item) => item.code === line.partyCode);
        const link = resolvePartyLink(party, line.accountKey);
        return {
          direction: line.direction, currencyCode: line.currencyCode,
          amount: Number(line.amount), accountCode: link?.accountCode || '',
          analyticalAccountCode: link?.analyticalAccountCode || '', analyticalType: link?.analyticalType || 0,
          description: line.description || journal.description,
        };
      }),
    };
  }, [tab, purchase, inventory, voucher, journal, reference, catalog.data, selectedCollector, voucherResolved, automaticReceiptDescription]);
  const payloadKey = JSON.stringify(payload);
  const requestRoute = tab === 'purchase' ? 'purchases' : tab === 'voucher' ? 'vouchers' : tab === 'journal' ? 'journals' : 'inventory-counts';

  const readyIssue = useMemo(() => {
    if (tab === 'purchase') {
      if (!purchase.warehouseCode || purchase.lines.some((line) => !line.itemCode || !line.unitCode || Number(line.quantity) <= 0)) return 'أكمل المستودع وكل أصناف طلب الشراء';
      return '';
    }
    if (tab === 'inventory') {
      if (!inventory.warehouseCode || !inventory.notes.trim() || inventory.lines.some((line) => !line.itemCode || !line.unitCode || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) < 0)) return 'أكمل المستودع والبيان وكل أصناف الجرد';
      return '';
    }
    if (tab === 'voucher') {
      if (!(voucher.description.trim() || automaticReceiptDescription) || !voucher.cashOrBankNo || !voucher.currencyCode || Number(voucher.amount) <= 0) return 'أكمل بيانات السند الأساسية ومبلغ الصندوق أو البنك';
      if (!selectedLocation?.currencyCodes.includes(voucher.currencyCode)) return 'عملة الصندوق أو البنك غير مفعلة للحساب المحدد في IAS20261';
      if (voucher.paymentMethod === 'bank_transfer' && (!voucher.referenceNo || !voucher.noticeNo)) return 'رقم المرجع ورقم الإشعار مطلوبان للتحويل البنكي';
      if (voucherResolved.some(({ line, party, link }) => !party || !link || !line.currencyCode || Number(line.amount) <= 0)) return 'اختر الطرف والحساب المرتبط والعملة والمبلغ لكل بند';
      if (voucherResolved.some(({ line, link }) => !link?.currencyCodes.includes(line.currencyCode))) return 'عملة أحد أطراف السند غير مفعلة للحساب المرتبط في IAS20261';
      if (voucher.kind === 'receipt' && !selectedCollector && (catalog.data?.collectors.length ?? 0) > 0) return 'اختر المحصل لأن العميل لا يملك محصلًا مسندًا';
      return '';
    }
    const resolved = journal.lines.map((line) => {
      const party = catalog.data?.parties[line.category]?.find((item) => item.code === line.partyCode);
      return { line, link: resolvePartyLink(party, line.accountKey) };
    });
    if (!journal.description || resolved.some(({ line, link }) => !link || !line.currencyCode || Number(line.amount) <= 0)) return 'أكمل طرف وعملة ومبلغ كل سطر في القيد';
    if (resolved.some(({ line, link }) => !link?.currencyCodes.includes(line.currencyCode))) return 'عملة أحد أسطر القيد غير مفعلة للحساب المرتبط في IAS20261';
    if (!journal.lines.some((line) => line.direction === 'debit') || !journal.lines.some((line) => line.direction === 'credit')) return 'يجب أن يحتوي القيد على مدين ودائن';
    return '';
  }, [tab, purchase, inventory, voucher, journal, voucherResolved, selectedCollector, catalog.data, selectedLocation, automaticReceiptDescription]);

  const dryRun = useMutation<DryRunResult>({
    mutationFn: () => api<DryRunResult>(`/oracle-test-requests/${requestRoute}/dry-run`, { method: 'POST', body: payloadKey }),
    onSuccess: (result) => {
      if (result.valid === false) {
        setApprovedPayload('');
        toast(result.issues?.map((issue) => issue.message).filter(Boolean).join('، ') || 'فحص الطلب يحتاج معالجة', 'err');
        return;
      }
      if (result.saveAllowed === false) setApprovedPayload('');
      else setApprovedPayload(payloadKey);
      toast(result.saveBlockedReason || 'نجح فحص الطلب — لم تُجرَ أي كتابة في Oracle', 'ok');
    },
    onError: (error: Error) => { setApprovedPayload(''); toast(actionError(error, 'فحص الطلب'), 'err'); },
  });
  const create = useMutation<{ created: boolean; requestNo?: string; requestSerial?: string; documentNo?: string; documentSerial?: string; verified?: boolean; readbackPending?: boolean; readbackWarning?: string }>({
    mutationFn: () => api(`/oracle-test-requests/${requestRoute}`, { method: 'POST', body: payloadKey }),
    onSuccess: (result) => {
      const number = result.requestNo ?? result.documentNo ?? '—';
      const inventoryReadbackPending = tab === 'inventory' && result.verified === false;
      toast(inventoryReadbackPending
        ? (result.readbackWarning || `تم حفظ مسودة الجرد رقم ${number}، وتعذر تحديث حالتها مؤقتًا. لا تعِد الحفظ.`)
        : result.created ? `تم إنشاء المسودة رقم ${number}` : `المسودة موجودة مسبقًا برقم ${number}`, 'ok');
      setApprovedPayload(''); setReference(createRequestId());
      queryClient.invalidateQueries({ queryKey: ['oracle-test-requests-created'] });
    },
    onError: (error: Error) => toast(actionError(error, 'حفظ المسودة'), 'err'),
  });
  if (!allowed) return <PermissionNotice message="لا تملك صلاحية عرض أو إنشاء طلبات يمن سوفت التجريبية." />;

  const changeTab = (next: Tab) => { setTab(next); setApprovedPayload(''); dryRun.reset(); };
  const updateVoucherLine = (id: string, change: Partial<PartyLine>) => {
    setVoucher((state) => ({ ...state, lines: state.lines.map((line) => line.id === id ? { ...line, ...change } : line) })); invalidate();
  };
  const updateJournalLine = (id: string, change: Partial<JournalLine>) => {
    setJournal((state) => ({ ...state, lines: state.lines.map((line) => line.id === id ? { ...line, ...change } : line) })); invalidate();
  };

  return <div className="space-y-5">
    <PageHeader title="عمليات ONYX" />
    <Card className="border-hazard-600/30"><div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div><p className="font-bold">IAS20261 — ربط الطلبات المرحلي</p><p className="text-sm text-ink-mid">القراءة والفحص من IAS20261. لا يُفعّل حفظ أي نوع طلب إلا عبر بوابة مستقلة محدودة الصلاحيات وبعد نجاح الفحص.</p></div>
      <Badge tone="hazard">قبول مرحلي</Badge>
    </div></Card>
    {!online && <div role="alert" className="rounded-lg border border-debt-600/30 bg-debt-50 p-4 text-sm text-debt-700 dark:bg-debt-700/10"><strong>لا يوجد اتصال بالشبكة.</strong> بقيت البيانات المدخلة في الصفحة، لكن فحص الطلب وحفظ المسودة متوقفان حتى عودة الاتصال.</div>}
    {online && (currencies.isLoading || created.isLoading) && <div role="status" className="rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-mid">جار الاتصال بالخادم وتحميل القوائم وحالات الطلبات…</div>}
    {financialAdjustment.isLoading && <div role="status" className="rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-mid">جار تحميل القيد المحفوظ لطلب الخصم أو التصفية…</div>}
    {financialAdjustment.isError && <div role="alert" className="rounded-lg border border-debt-600/30 bg-debt-50 p-3 text-sm text-debt-700">تعذر تحميل القيد المحفوظ. ارجع إلى طلبات الخصم والتصفية ثم أعد فتحه.</div>}
    {financialAdjustment.data && <div role="status" className="rounded-lg border border-pine-600/30 bg-pine-50 p-3 text-sm text-pine-800 dark:bg-pine-900/20 dark:text-pine-100">تم تحميل القيد المحفوظ للعميل {financialAdjustment.data.customer.name}. افحص ربط الحسابين والعملة ثم نفّذ Dry Run؛ لم تُكتب بيانات في Oracle.</div>}
    {canCreateAny && <>
    <div className="flex flex-wrap gap-2">
      {([['purchase','طلب شراء'],['voucher','سند قبض أو صرف'],['journal','قيد يومي'],['inventory','جرد مخزون']] as const).filter(([value]) => createTabs.includes(value)).map(([value,label]) =>
        <Button key={value} variant={tab === value ? 'primary' : 'secondary'} onClick={() => changeTab(value)}>{label}</Button>)}
    </div>
    <Card><CardHeader title={tab === 'purchase' ? 'طلب شراء APST001.125' : tab === 'voucher' ? 'طلب سند GLST018' : tab === 'journal' ? 'طلب قيد يومي GLST017.298' : 'جرد مخزون INVT008.230'} />
      {tab === 'purchase' && <div className="space-y-4 p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <SearchableCatalogSelect
            id="purchase-warehouse"
            label="المستودع"
            value={purchase.warehouseCode}
            options={(purchaseWarehouses.data?.items ?? []).map((warehouse) => ({ value: warehouse.externalWarehouseCode, code: warehouse.externalWarehouseCode, name: warehouse.nameAr, detail: warehouse.externalBranchCode ? `الفرع ${warehouse.externalBranchCode}` : null }))}
            placeholder={purchaseWarehouses.isLoading ? 'جار تحميل المستودعات…' : 'اختر المستودع'}
            searchPlaceholder="ابحث برقم المستودع أو اسمه"
            onChange={(value) => { setPurchase((state) => ({ ...state, warehouseCode: value })); invalidate(); }}
          />
          <Field label="البيان"><Textarea value={purchase.notes} onChange={(e) => { setPurchase({...purchase,notes:e.target.value}); invalidate(); }} /></Field>
        </div>
        {purchaseWarehouses.isError && <div role="alert" className="rounded-lg border border-debt-600/25 p-3 text-sm text-debt-600">تعذر تحميل مستودعات IAS20261. تحقق من بوابة القراءة ثم أعد المحاولة.</div>}
        <div className="space-y-3">
          {purchase.lines.map((line, index) => <PurchaseLineEditor
            key={line.id}
            index={index}
            line={line}
            warehouseCode={purchase.warehouseCode}
            onChange={(change) => { setPurchase((state) => ({ ...state, lines: state.lines.map((item) => item.id === line.id ? { ...item, ...change } : item) })); invalidate(); }}
            onRemove={() => { setPurchase((state) => ({ ...state, lines: state.lines.filter((item) => item.id !== line.id) })); invalidate(); }}
            canRemove={purchase.lines.length > 1}
          />)}
        </div>
        <Button variant="secondary" onClick={() => { setPurchase((state)=>({...state,lines:[...state.lines,{id:newId(),itemCode:'',itemName:'',unitCode:'',quantity:'1'}]})); invalidate(); }}><Plus className="h-4 w-4" />إضافة صنف</Button>
      </div>}

      {tab === 'inventory' && <div className="space-y-4 p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <SearchableCatalogSelect
            id="inventory-warehouse"
            label="المستودع"
            value={inventory.warehouseCode}
            options={(purchaseWarehouses.data?.items ?? []).map((warehouse) => ({ value: warehouse.externalWarehouseCode, code: warehouse.externalWarehouseCode, name: warehouse.nameAr, detail: warehouse.externalBranchCode ? `الفرع ${warehouse.externalBranchCode}` : null }))}
            placeholder={purchaseWarehouses.isLoading ? 'جار تحميل المستودعات…' : 'اختر المستودع'}
            searchPlaceholder="ابحث برقم المستودع أو اسمه"
            onChange={(value) => { setInventory((state) => ({ ...state, warehouseCode: value })); invalidate(); }}
          />
          <Field label="بيان الجرد"><Textarea value={inventory.notes} onChange={(event) => { setInventory((state) => ({ ...state, notes: event.target.value })); invalidate(); }} /></Field>
        </div>
        {purchaseWarehouses.isError && <div role="alert" className="rounded-lg border border-debt-600/25 p-3 text-sm text-debt-600">تعذر تحميل مستودعات IAS20261. تحقق من بوابة القراءة ثم أعد المحاولة.</div>}
        <div className="space-y-3">
          {inventory.lines.map((line, index) => <PurchaseLineEditor
            key={line.id}
            index={index}
            line={line}
            warehouseCode={inventory.warehouseCode}
            quantityLabel="كمية الجرد"
            onChange={(change) => { setInventory((state) => ({ ...state, lines: state.lines.map((item) => item.id === line.id ? { ...item, ...change } : item) })); invalidate(); }}
            onRemove={() => { setInventory((state) => ({ ...state, lines: state.lines.filter((item) => item.id !== line.id) })); invalidate(); }}
            canRemove={inventory.lines.length > 1}
          />)}
        </div>
        <Button variant="secondary" onClick={() => { setInventory((state)=>({...state,lines:[...state.lines,{id:newId(),itemCode:'',itemName:'',unitCode:'',quantity:'0'}]})); invalidate(); }}><Plus className="h-4 w-4" />إضافة صنف</Button>
      </div>}

      {tab === 'voucher' && <div className="space-y-4 p-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Segmented label="نوع السند" value={voucher.kind} options={([['receipt','قبض'],['payment','صرف']] as Array<['receipt'|'payment', string]>).filter(([value]) => canCreate(value))} onChange={(value) => { setVoucher({...voucher,kind:value as 'receipt'|'payment',collectorCode:''}); invalidate(); }} />
          <Segmented label="طريقة الدفع" value={voucher.paymentMethod} options={[['cash','نقدي'],['bank_transfer','تحويل بنكي']]} onChange={(value) => { setVoucher({...voucher,paymentMethod:value as 'cash'|'bank_transfer',cashOrBankNo:''}); invalidate(); }} />
          <SearchableCatalogSelect
            id="voucher-currency"
            label="عملة الصندوق أو البنك"
            value={voucher.currencyCode}
            options={locationCurrencyOptions.map((item) => ({ value: item.code, code: item.code, name: oracleCurrencyLabel(item.code, item.nameAr), detail: item.local ? 'العملة المحلية' : `سعر النظام ${item.rate}` }))}
            placeholder="اختر العملة"
            searchPlaceholder="ابحث برمز العملة أو اسمها"
            onChange={(value) => { setVoucher({...voucher,currencyCode:value}); invalidate(); }}
          />
          <Field label="مبلغ الصندوق أو البنك"><Input type="number" min="0.01" value={voucher.amount} onChange={(e) => { setVoucher({...voucher,amount:e.target.value}); invalidate(); }} /></Field>
          <SearchableCatalogSelect
            id="voucher-location"
            label={voucher.paymentMethod === 'cash' ? 'الصندوق المتاح' : 'البنك المتاح'}
            value={voucher.cashOrBankNo}
            options={locations.map((item) => ({ value: item.code, code: item.code, name: item.nameAr, detail: item.accountCode ?? '—' }))}
            placeholder={voucher.paymentMethod === 'cash' ? 'اختر الصندوق' : 'اختر البنك'}
            searchPlaceholder={voucher.paymentMethod === 'cash' ? 'ابحث برقم الصندوق أو اسمه' : 'ابحث برقم البنك أو اسمه أو رقم الحساب'}
            onChange={(value) => { setVoucher({...voucher,cashOrBankNo:value,currencyCode:''}); invalidate(); }}
          />
          <Field label="البيان"><Input value={voucher.description} placeholder={automaticReceiptDescription || 'اكتب بيان السند'} onChange={(e) => { setVoucher({...voucher,description:e.target.value}); invalidate(); }} /></Field>
          <Field label="المستلم"><Input value={voucher.recipientName} placeholder={voucher.kind === 'payment' ? 'يُستنتج من أطراف السند عند تركه فارغًا' : 'اسم المستلم'} onChange={(e) => { setVoucher({...voucher,recipientName:e.target.value}); invalidate(); }} /></Field>
          <Field label="رقم المرجع"><Input maxLength={15} value={voucher.referenceNo} onChange={(e) => { setVoucher({...voucher,referenceNo:e.target.value}); invalidate(); }} /></Field>
          {voucher.paymentMethod === 'bank_transfer' && <Field label="رقم الإشعار"><Input maxLength={30} value={voucher.noticeNo} onChange={(e) => { setVoucher({...voucher,noticeNo:e.target.value}); invalidate(); }} /></Field>}
        </div>
        {voucherConversion && <div className="rounded-lg border border-line p-3 text-sm">المقابل بسعر النظام: {voucherConversion.amount} {singleVoucherLine?.currencyCode} — سعر التحويل: {voucherConversion.rate.toPrecision(8)}. يعاد فحص السعر والتوازن قبل الإرسال.
          {voucherConversion.roundingDifference !== 0 && <p className="text-red-600">فرق التقريب بالعملة المحلية: {voucherConversion.roundingDifference}. يلزم نجاح فحص التوازن.</p>}
        </div>}
        {voucher.lines.length > 1 && <p className="text-sm text-ink-mid">للسند متعدد الأطراف، وزّع المبلغ بينها يدويًا؛ لا يُنسخ المبلغ كاملًا لكل طرف.</p>}
        {voucher.kind === 'receipt' && automaticReceiptDescription && !voucher.description.trim() && <div className="rounded-lg border border-pine-600/25 bg-pine-50 p-3 text-sm text-pine-800 dark:bg-pine-900/20 dark:text-pine-100"><strong>البيان التلقائي:</strong> {automaticReceiptDescription}</div>}
        {voucher.kind === 'receipt' && <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm">
          {assignedCollector ? <>المحصل المسند تلقائيًا: <strong>{assignedCollector.nameAr}</strong>{assignedCollector.commissionPercent == null ? ' — لا توجد نسبة عمولة معرفة' : ` — العمولة ${assignedCollector.commissionPercent}%`}</> :
            <Field label="المحصل المتاح"><Select value={voucher.collectorCode} onChange={(e) => { setVoucher({...voucher,collectorCode:e.target.value}); invalidate(); }}><option value="">بدون محصل</option>{catalog.data?.collectors.map((item)=><option key={item.code} value={item.code}>{item.nameAr} — {item.code}</option>)}</Select></Field>}
        </div>}
        {voucher.lines.map((line, index) => {
          const selectedParty = catalog.data?.parties[line.category]?.find((item) => item.code === line.partyCode);
          const partyCurrencyCodes = allowedPartyCurrencies(selectedParty, line.accountKey);
          const partyCurrencyOptions = currencyOptions.filter((item) => partyCurrencyCodes.includes(item.code));
          return <details key={line.id} className="group rounded-lg border border-line bg-surface-1">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3"><span><strong>طرف السند {index + 1}</strong><span className="mr-2 text-sm text-ink-mid">{selectedParty ? `${selectedParty.nameAr} — ${selectedParty.code}` : 'لم يُحدد بعد'}{line.amount ? ` • ${line.amount} ${line.currencyCode}` : ''}</span></span><ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" /></summary>
            <div className="space-y-3 border-t border-line p-3">
              <div className="flex justify-end"><Button variant="danger" disabled={voucher.lines.length === 1} onClick={() => { setVoucher((state)=>({...state,lines:state.lines.filter((item)=>item.id!==line.id)})); invalidate(); }}><Trash2 className="h-4 w-4" />حذف الطرف</Button></div>
              <PartySelectors catalog={catalog.data} line={line} onChange={(change)=>updateVoucherLine(line.id, change)} />
              <div className="grid gap-3 md:grid-cols-4">
                <SearchableCatalogSelect
                  id={`voucher-line-currency-${line.id}`}
                  label="عملة الطرف"
                  value={line.currencyCode}
                  options={partyCurrencyOptions.map((item) => ({ value: item.code, code: item.code, name: oracleCurrencyLabel(item.code, item.nameAr), detail: item.local ? 'العملة المحلية' : `سعر النظام ${item.rate}` }))}
                  placeholder="اختر العملة"
                  searchPlaceholder="ابحث برمز العملة أو اسمها"
                  onChange={(value)=>updateVoucherLine(line.id,{currencyCode:value})}
                />
                <Field label="مبلغ الطرف"><Input type="number" min="0.01" value={line.amount} onChange={(e)=>updateVoucherLine(line.id,{amount:e.target.value})} /></Field>
                <div className="md:col-span-2"><Field label="بيان السطر"><Input value={line.description} onChange={(e)=>updateVoucherLine(line.id,{description:e.target.value})} /></Field></div>
              </div>
            </div>
          </details>;
        })}
        <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="secondary" onClick={() => { setVoucher((state)=>({...state,lines:[...state.lines,{id:newId(),category:'customers',partyCode:'',accountKey:'',currencyCode:'',amount:'',description:''}]})); invalidate(); }}><Plus className="h-4 w-4" />إضافة طرف</Button><strong>الصندوق أو البنك: {voucher.amount || '0'} {voucher.currencyCode}</strong></div>
      </div>}

      {tab === 'journal' && <div className="space-y-4 p-4">
        <div className="grid gap-4 md:grid-cols-2"><Field label="البيان"><Input value={journal.description} onChange={(e) => { setJournal({...journal,description:e.target.value}); invalidate(); }} /></Field><Field label="رقم المرجع (يمكن تكراره)"><Input value={journal.referenceNo} onChange={(e) => { setJournal({...journal,referenceNo:e.target.value}); invalidate(); }} /></Field></div>
        {journal.lines.map((line, index) => {
          const selectedParty = catalog.data?.parties[line.category]?.find((item) => item.code === line.partyCode);
          const partyCurrencyCodes = allowedPartyCurrencies(selectedParty, line.accountKey);
          const partyCurrencyOptions = currencyOptions.filter((item) => partyCurrencyCodes.includes(item.code));
          return <details key={line.id} className="group rounded-lg border border-line bg-surface-1">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3"><span><strong>سطر القيد {index + 1} — {line.direction === 'debit' ? 'مدين' : 'دائن'}</strong><span className="mr-2 text-sm text-ink-mid">{selectedParty ? `${selectedParty.nameAr} — ${selectedParty.code}` : 'لم يُحدد الطرف'}{line.amount ? ` • ${line.amount} ${line.currencyCode}` : ''}</span></span><ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" /></summary>
            <div className="space-y-3 border-t border-line p-3">
              <div className="flex justify-end"><Button variant="danger" disabled={journal.lines.length <= 2} onClick={() => { setJournal((state)=>({...state,lines:state.lines.filter((item)=>item.id!==line.id)})); invalidate(); }}><Trash2 className="h-4 w-4" />حذف السطر</Button></div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="الطرف"><Select value={line.direction} onChange={(e)=>updateJournalLine(line.id,{direction:e.target.value as 'debit'|'credit'})}><option value="debit">مدين</option><option value="credit">دائن</option></Select></Field>
                <SearchableCatalogSelect
                  id={`journal-line-currency-${line.id}`}
                  label="العملة"
                  value={line.currencyCode}
                  options={partyCurrencyOptions.map((item) => ({ value: item.code, code: item.code, name: oracleCurrencyLabel(item.code, item.nameAr), detail: item.local ? 'العملة المحلية' : `سعر النظام ${item.rate}` }))}
                  placeholder="اختر العملة"
                  searchPlaceholder="ابحث برمز العملة أو اسمها"
                  onChange={(value)=>updateJournalLine(line.id,{currencyCode:value})}
                />
              </div>
              <PartySelectors catalog={catalog.data} line={line} onChange={(change)=>updateJournalLine(line.id, change)} />
              <div className="grid gap-3 md:grid-cols-3"><Field label="المبلغ"><Input type="number" min="0.01" value={line.amount} onChange={(e)=>updateJournalLine(line.id,{amount:e.target.value})} /></Field><div className="md:col-span-2"><Field label="بيان السطر"><Input value={line.description} onChange={(e)=>updateJournalLine(line.id,{description:e.target.value})} /></Field></div></div>
            </div>
          </details>;
        })}
        <Button variant="secondary" onClick={() => { setJournal((state)=>({...state,lines:[...state.lines,{id:newId(),direction:'debit',currencyCode:'',category:'other',partyCode:'',accountKey:'',amount:'',description:''}]})); invalidate(); }}><Plus className="h-4 w-4" />إضافة سطر</Button>
      </div>}

    {catalog.isFetching && (tab === 'voucher' || tab === 'journal') && <div role="status" className="mx-4 mb-4 rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-mid">جار تحميل الأطراف والحسابات من IAS20261 للقراءة فقط… ستبقى مدخلاتك محفوظة في الصفحة أثناء الانتظار.</div>}
      {catalog.data?.currencyMapping?.complete === false && (tab === 'voucher' || tab === 'journal') && <div role="alert" className="mx-4 mb-4 rounded-lg border border-hazard-600/25 bg-hazard-50 p-3 text-sm text-hazard-700 dark:bg-hazard-700/10"><strong>تأكيد عملات الحسابات متوقف.</strong> يحتاج ALBINAA_RO صلاحية قراءة CUSTOMER_CURR وACCOUNT_CURR في IAS20261؛ تم منع فحص السند بدل تخمين عملة الحساب.</div>}
      {catalog.isError && (tab === 'voucher' || tab === 'journal') && <div role="alert" className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-debt-600/25 p-3 text-sm text-debt-600"><span><strong>تعذر تحميل الأطراف والحسابات.</strong> تحقق من اتصال بوابة Oracle، ثم أعد المحاولة؛ لم تُرسل أي بيانات.</span><Button variant="secondary" onClick={() => catalog.refetch()}>إعادة المحاولة</Button></div>}
      {readyIssue && <div className="mx-4 mb-4 rounded-lg border border-hazard-600/25 p-3 text-sm text-hazard-700">{readyIssue}</div>}
      {dryRun.isPending && <div role="status" className="mx-4 mb-4 rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-mid">جار فحص الطلب والتحقق من الحسابات والأرصدة… انتظر حتى تظهر النتيجة.</div>}
      {create.isPending && <div role="status" className="mx-4 mb-4 rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-mid">جار تنفيذ العملية المصرح بها… لا تغلق الصفحة حتى تظهر النتيجة.</div>}
      {(approvedPayload === payloadKey || dryRun.data?.valid) && <div className="mx-4 mb-4 rounded-lg border border-credit-600/25 bg-credit-50 p-3 text-sm text-credit-700 dark:bg-credit-700/10">{dryRun.data?.saveBlockedReason || 'فحص الطلب ناجح — لم تُجرَ أي كتابة في Oracle.'}</div>}
      {tab === 'voucher' && dryRun.data?.valid && <div className="mx-4 mb-4 grid gap-3 rounded-lg border border-line bg-surface-2 p-3 text-sm md:grid-cols-3">
        <div><span className="block text-ink-mid">قيمة الصندوق أو البنك محليًا</span><strong>{dryRun.data?.localAmount ?? '—'} {dryRun.data?.localCurrency ?? ''}</strong></div>
        <div><span className="block text-ink-mid">مجموع أطراف السند محليًا</span><strong>{dryRun.data?.counterpartyLocalAmount ?? '—'} {dryRun.data?.localCurrency ?? ''}</strong></div>
        <div><span className="block text-ink-mid">فرق التوازن</span><strong>{dryRun.data?.localBalance ?? '—'} {dryRun.data?.localCurrency ?? ''}</strong></div>
      </div>}
      {approvedPayload === payloadKey && tab === 'journal' && <div className="mx-4 mb-4 rounded-lg border border-line bg-surface-2 p-3 text-sm">
        فرق القيد بعد تحويل جميع العملات إلى {dryRun.data?.localCurrency ?? 'العملة المحلية'}: <strong>{dryRun.data?.localBalance ?? '—'}</strong>
      </div>}
      {dryRun.data?.valid === false && <div className="mx-4 mb-4 rounded-lg border border-hazard-600/25 bg-hazard-50 p-3 text-sm text-hazard-700 dark:bg-hazard-700/10">{dryRun.data.issues?.map((issue) => issue.message).filter(Boolean).join('، ') || 'فحص الطلب يحتاج معالجة'}</div>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line p-4"><Button variant="secondary" loading={dryRun.isPending} disabled={!online || Boolean(readyIssue)} onClick={() => dryRun.mutate()}>فحص الطلب</Button><Button variant="success" loading={create.isPending} disabled={!online || approvedPayload !== payloadKey || dryRun.data?.saveAllowed === false} onClick={() => create.mutate()}>{dryRun.data?.saveAllowed === false ? 'الحفظ غير مفعّل لهذا الطلب' : 'حفظ مسودة'}</Button></div>
    </Card>
    </>}
    <Card>
      <CardHeader title="العمليات المنشأة" action={<Button variant="secondary" loading={created.isFetching} onClick={() => created.refetch()}><RefreshCw className="h-4 w-4" />تحديث الحالة</Button>} />
      <div className="border-b border-line px-4 py-3 text-sm text-ink-mid">الحسابات والعملات والأصناف والصناديق تُقرأ مباشرة من <strong>IAS20261</strong>. لا يُتاح الحفظ إلا عبر بوابة مستقلة محدودة الصلاحيات وبعد نجاح الفحص؛ تحديث الحالة هنا قراءة فقط.</div>
      {created.isFetching && created.data && <div role="status" className="mx-4 mt-4 rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-mid">جار تحديث حالات الطلبات من Oracle…</div>}
      {created.isError && <div role="alert" className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-debt-600/25 p-3 text-sm text-debt-600"><span><strong>تعذر قراءة حالات الطلبات.</strong> تحقق من اتصال بوابة Oracle؛ ستظل آخر بيانات ظاهرة دون تغيير.</span><Button variant="secondary" onClick={() => created.refetch()}>إعادة المحاولة</Button></div>}
      {!created.isError && created.data?.partial && <div role="alert" className="m-4 rounded-lg border border-hazard-600/25 bg-hazard-50 p-3 text-sm text-hazard-700 dark:bg-hazard-700/10"><strong>عُرضت الحالات المتاحة فقط.</strong> تعذر قراءة سندات القبض من IAS20261 لأن حساب القراءة يحتاج صلاحية SELECT على IAS_RQ_VCHR_MST؛ لم تُجرَ أي كتابة في Oracle.</div>}
      {!created.isLoading && !created.isError && (created.data?.items.length ?? 0) === 0 && <div className="p-6 text-center text-sm text-ink-mid">لا توجد طلبات منشأة متاحة ضمن صلاحياتك.</div>}
      <div className="divide-y divide-line">
        {created.data?.items.map((item) => <div key={`${item.kind}:${item.requestSerial}`} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))] md:items-center">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong>{requestLabels[item.kind]} رقم {item.requestNo}</strong>{item.kind === 'inventory_transfer' && <ArrowRightLeft className="h-4 w-4 text-pine-600" />}</div><p className="truncate text-xs text-ink-mid">{item.description || item.requestSerial}</p></div>
          <div><span className="block text-xs text-ink-mid">الحالة</span><Badge tone={item.status === 'approved' ? 'credit' : item.status === 'rejected' || item.status === 'inactive' ? 'debt' : 'hazard'}>{item.statusLabel ?? statusLabels[item.status]}</Badge></div>
          <div><span className="block text-xs text-ink-mid">مستوى الاعتماد</span><strong>{item.approval?.level ?? '—'}</strong></div>
          <div><span className="block text-xs text-ink-mid">المستخدم</span><strong>{item.approval?.userId ?? '—'}</strong></div>
          <div><span className="block text-xs text-ink-mid">تاريخ الاعتماد</span><strong className="text-sm">{item.approval?.date ?? '—'}</strong>{item.attachment && <Button variant="secondary" className="mt-2 w-full" onClick={() => previewAttachment(item)}><Eye className="h-4 w-4" />صورة الإيصال</Button>}</div>
        </div>)}
      </div>
      {can('inventory_transfers.read') && <div className="flex justify-end border-t border-line p-4"><Link className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm font-semibold" href="/inventory-transfers"><ArrowRightLeft className="h-4 w-4" />فتح التحويلات المخزنية</Link></div>}
    </Card>
  </div>;
}

function preferredPurchaseUnit(item: OracleItemDetail | undefined) {
  const active = item?.units.filter((unit) => !unit.isInactive) ?? [];
  return active.find((unit) => unit.isPurchaseUnit)?.unitName
    ?? active.find((unit) => unit.isMainUnit)?.unitName
    ?? active.find((unit) => unit.isStockUnit)?.unitName
    ?? active[0]?.unitName
    ?? '';
}

function PurchaseLineEditor({ index, line, warehouseCode, onChange, onRemove, canRemove, quantityLabel = 'الكمية' }: {
  index: number;
  line: PurchaseLine;
  warehouseCode: string;
  onChange: (change: Partial<PurchaseLine>) => void;
  onRemove: () => void;
  canRemove: boolean;
  quantityLabel?: string;
}) {
  const [search, setSearch] = useState(line.itemCode ? `${line.itemCode} — ${line.itemName}` : '');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showChoices, setShowChoices] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const choices = useQuery<OracleItemsResponse>({
    queryKey: ['oracle-test-purchase-items', debouncedSearch],
    queryFn: () => api(`/oracle-test-requests/purchases/lookups/items?search=${encodeURIComponent(debouncedSearch)}&limit=20`),
    enabled: showChoices && debouncedSearch.length >= 2,
    staleTime: 60_000,
  });
  const detail = useQuery<OracleItemDetail>({
    queryKey: ['oracle-test-purchase-item', line.itemCode],
    queryFn: () => api(`/oracle-test-requests/purchases/lookups/items/${encodeURIComponent(line.itemCode)}`),
    enabled: Boolean(line.itemCode),
    staleTime: 60_000,
  });
  const activeUnits = useMemo(() => detail.data?.units.filter((unit) => !unit.isInactive) ?? [], [detail.data]);
  useEffect(() => {
    if (!detail.data || activeUnits.some((unit) => unit.unitName === line.unitCode)) return;
    onChange({ unitCode: preferredPurchaseUnit(detail.data) });
  }, [activeUnits, detail.data, line.unitCode, onChange]);
  const selectItem = (item: OracleInventoryItem) => {
    setSearch(`${item.externalItemCode} — ${item.nameAr}`);
    setShowChoices(false);
    onChange({ itemCode: item.externalItemCode, itemName: item.nameAr, unitCode: '' });
  };
  const stockRow = detail.data?.stockRows.find((row) => row.externalWarehouseCode === warehouseCode && row.unitName === line.unitCode && !row.isInactive);

  return <div className="relative rounded-lg border border-line bg-surface-1 p-3">
    <div className="mb-3 flex items-start justify-between gap-3">
      <div><strong>الصنف {index + 1}{line.itemName ? `: ${line.itemName}` : ''}</strong>{line.itemCode && <span className="mt-1 block text-xs text-ink-mid" dir="ltr">{line.itemCode}</span>}</div>
      <Button type="button" variant="ghost" className="px-3 text-debt-600" aria-label={`حذف الصنف ${index + 1}`} disabled={!canRemove} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
    </div>
    <div className="grid gap-3 md:grid-cols-[1.5fr_.7fr_.55fr]">
      <div className="relative space-y-1.5">
        <label htmlFor={`purchase-item-${line.id}`} className="block text-sm font-medium text-concrete-700 dark:text-concrete-200">بحث الصنف</label>
        <div className="relative"><Search className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-ink-low" /><Input id={`purchase-item-${line.id}`} className="pr-10" value={search} autoComplete="off" placeholder="اكتب اسم الصنف أو الكود أو المقاس" onFocus={() => setShowChoices(true)} onBlur={() => window.setTimeout(() => setShowChoices(false), 150)} onChange={(event) => { setSearch(event.target.value); setShowChoices(true); if (line.itemCode) onChange({ itemCode: '', itemName: '', unitCode: '' }); }} /></div>
        {showChoices && debouncedSearch.length >= 2 && <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface-1 p-1 shadow-xl">
          {choices.isLoading && <p className="px-3 py-2 text-xs text-ink-mid">جار البحث في أصناف IAS20261…</p>}
          {choices.isError && <p className="px-3 py-2 text-xs text-debt-600">تعذر البحث في الأصناف.</p>}
          {!choices.isLoading && choices.data?.items.length === 0 && <p className="px-3 py-2 text-xs text-ink-mid">لا يوجد صنف مطابق.</p>}
          {choices.data?.items.map((item) => <button key={item.externalItemCode} type="button" className="block w-full rounded-md px-3 py-2 text-right text-sm hover:bg-surface-3" onMouseDown={(event) => event.preventDefault()} onClick={() => selectItem(item)}><strong>{item.nameAr}</strong><span className="mt-0.5 block text-xs text-ink-mid" dir="ltr">{item.externalItemCode}</span></button>)}
        </div>}
        {search.trim().length > 0 && search.trim().length < 2 && <span className="text-xs text-ink-mid">اكتب حرفين على الأقل.</span>}
      </div>
      <Field label="الوحدة"><Select value={line.unitCode} disabled={!line.itemCode || detail.isLoading || detail.isError} onChange={(event) => onChange({ unitCode: event.target.value })}><option value="">{detail.isLoading ? 'جار التحميل…' : 'اختر الوحدة'}</option>{activeUnits.map((unit) => <option key={`${unit.unitName}-${unit.packageSize}`} value={unit.unitName}>{unit.unitName}{unit.isPurchaseUnit ? ' — وحدة شراء' : ''}</option>)}</Select></Field>
      <Field label={quantityLabel}><Input type="number" min={quantityLabel === 'كمية الجرد' ? '0' : '0.0001'} step="any" value={line.quantity} onChange={(event) => onChange({ quantity: event.target.value })} /></Field>
    </div>
    {detail.isError && <p role="alert" className="mt-2 text-xs text-debt-600">تعذر تحميل وحدات الصنف.</p>}
    {line.itemCode && detail.data && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-surface-2 p-2 text-xs text-ink-mid"><span>المستودع: <strong>{warehouseCode || 'اختر المستودع'}</strong></span><span>المتوفر: <strong>{warehouseCode && line.unitCode ? Number(stockRow?.availableQuantity ?? 0).toLocaleString('en-US') : '—'} {line.unitCode}</strong></span><span>حجم العبوة: <strong>{stockRow?.packageSize ?? '—'}</strong></span></div>}
  </div>;
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: Array<[string,string]>; onChange: (value: string) => void }) {
  return <Field label={label}><div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface-2 p-1">{options.map(([key,text])=><Button key={key} variant={value===key?'primary':'ghost'} onClick={()=>onChange(key)}>{text}</Button>)}</div></Field>;
}

type CatalogChoice = { value: string; code: string; name: string; detail?: string | null };

function SearchableCatalogSelect({
  id, label, value, options, placeholder, searchPlaceholder, onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: CatalogChoice[];
  placeholder: string;
  searchPlaceholder: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((item) => item.value === value);
  const needle = search.trim().toLocaleLowerCase('ar');
  const visible = needle
    ? options.filter((item) => `${item.code} ${item.name} ${item.detail ?? ''}`.toLocaleLowerCase('ar').includes(needle))
    : options;
  return <div className="relative space-y-1.5" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <span id={`${id}-label`} className="block text-sm font-medium text-concrete-700 dark:text-concrete-200">{label}</span>
    <button
      type="button"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-labelledby={`${id}-label`}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-concrete-200 bg-white px-3 py-2 text-sm focus:border-pine-500 dark:border-line dark:bg-surface-3 dark:text-ink-hi"
      onClick={() => setOpen((current) => !current)}
    >
      <span className={selected ? 'min-w-0 truncate' : 'text-concrete-400'}>
        {selected ? `${selected.name} — ${selected.code}` : placeholder}
      </span>
      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
    </button>
    {open && <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface-1 shadow-xl md:min-w-[20rem]">
      <div className="border-b border-line p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-low" aria-hidden />
          <Input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder} className="pe-9" />
        </div>
      </div>
      <div role="listbox" aria-labelledby={`${id}-label`} className="max-h-64 overflow-y-auto p-1">
        {visible.length === 0 && <p className="px-3 py-4 text-center text-sm text-ink-mid">لا توجد نتائج مطابقة.</p>}
        {visible.map((item) => <button
          key={item.value}
          type="button"
          role="option"
          aria-selected={item.value === value}
          className={`grid w-full grid-cols-[minmax(4rem,auto)_minmax(0,1fr)_minmax(6rem,auto)] items-center gap-3 rounded-lg px-3 py-2 text-right text-sm hover:bg-surface-3 ${item.value === value ? 'bg-brand/10' : ''}`}
          onClick={() => { onChange(item.value); setOpen(false); setSearch(''); }}
        >
          <bdi className="font-semibold">{item.code}</bdi>
          <span className="truncate">{item.name}</span>
          <bdi className="truncate text-xs text-ink-mid">{item.detail ?? '—'}</bdi>
        </button>)}
      </div>
      <p className="border-t border-line px-3 py-2 text-xs text-ink-mid">{visible.length} نتيجة</p>
    </div>}
  </div>;
}

function PartySelectors({ catalog, line, onChange }: { catalog?: OracleRequestCatalog; line: PartyLine; onChange: (change: Partial<PartyLine>) => void }) {
  const [partySearch, setPartySearch] = useState('');
  const [partyMenuOpen, setPartyMenuOpen] = useState(false);
  const parties = catalog?.parties[line.category] ?? [];
  const party: OracleParty | undefined = parties.find((item) => item.code === line.partyCode);
  const visibleParties = filterParties(parties, partySearch);
  return <div className="grid gap-3 md:grid-cols-3">
    <Field label="فئة الطرف"><Select value={line.category} onChange={(e)=>{onChange({category:e.target.value as PartyCategory,partyCode:'',accountKey:'',currencyCode:''});setPartySearch('');setPartyMenuOpen(false);}}>{(Object.entries(partyCategoryLabels) as Array<[PartyCategory,string]>).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select></Field>
    <div className="relative space-y-1.5 md:col-span-2" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPartyMenuOpen(false);
    }}>
      <span id={`party-label-${line.id}`} className="block text-sm font-medium text-concrete-700 dark:text-concrete-200">الطرف</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={partyMenuOpen}
        aria-labelledby={`party-label-${line.id}`}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-concrete-200 bg-white px-3 py-2 text-sm focus:border-pine-500 dark:border-line dark:bg-surface-3 dark:text-ink-hi"
        onClick={() => setPartyMenuOpen((open) => !open)}
      >
        <span className={party ? 'min-w-0 truncate' : 'text-concrete-400'}>{party ? `${party.nameAr} — ${party.code}` : 'اختر الطرف'}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${partyMenuOpen ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {partyMenuOpen && <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface-1 shadow-xl">
        <div className="border-b border-line p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-low" aria-hidden />
            <Input
              autoFocus
              value={partySearch}
              onChange={(event) => setPartySearch(event.target.value)}
              placeholder="ابحث بالرقم أو الاسم أو رقم الهاتف"
              className="pe-9"
              aria-label="بحث الطرف بالرقم أو الاسم أو رقم الهاتف"
            />
          </div>
        </div>
        <div role="listbox" aria-labelledby={`party-label-${line.id}`} className="max-h-64 overflow-y-auto p-1">
          {visibleParties.length === 0 && <p className="px-3 py-4 text-center text-sm text-ink-mid">لا توجد نتائج مطابقة.</p>}
          {visibleParties.map((item) => <button
            key={item.code}
            type="button"
            role="option"
            aria-selected={item.code === line.partyCode}
            className={`grid w-full grid-cols-[minmax(5rem,auto)_minmax(0,1fr)_minmax(6rem,auto)] items-center gap-3 rounded-lg px-3 py-2 text-right text-sm hover:bg-surface-3 ${item.code === line.partyCode ? 'bg-brand/10' : ''}`}
            onClick={() => { onChange({partyCode:item.code,accountKey:'',currencyCode:''}); setPartyMenuOpen(false); setPartySearch(''); }}
          >
            <bdi className="font-semibold">{item.code}</bdi>
            <span className="truncate">{item.nameAr}</span>
            <bdi className="truncate text-xs text-ink-mid">{item.phone ?? item.linkedAccounts[0]?.accountCode ?? '—'}</bdi>
          </button>)}
        </div>
        <p className="border-t border-line px-3 py-2 text-xs text-ink-mid">{visibleParties.length} نتيجة</p>
      </div>}
    </div>
    {party && party.linkedAccounts.length > 1 && <div className="md:col-span-3"><Field label="الحساب المرتبط"><Select value={line.accountKey} onChange={(e)=>onChange({accountKey:e.target.value,currencyCode:''})}><option value="">اختر الحساب</option>{party.linkedAccounts.map((link)=><option key={accountLinkKey(link)} value={accountLinkKey(link)}>{link.accountGroupNameAr ? `${link.accountGroupNameAr} — ` : ''}{link.accountName} — {link.analyticalAccountName} — {(link.currencyCodes ?? []).join('، ') || 'دون عملة'}</option>)}</Select></Field></div>}
    {party && party.linkedAccounts.length === 0 && <div className="rounded-lg border border-hazard-600/25 p-3 text-xs text-hazard-700 md:col-span-3">لا يوجد ربط حسابي مؤكد لهذا الطرف في IAS20261.</div>}
  </div>;
}
