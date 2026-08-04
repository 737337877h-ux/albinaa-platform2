'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { ArrowDownUp, CheckCircle2, Download, Eye, Pencil, Phone, MessageSquare, MessageCircle, MapPin, Building2, UserCheck, Clock, AlertTriangle, UserX, Link2, Unlink } from 'lucide-react';
import { api, apiFileBlob, ApiError, downloadApiFile } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, CCY_AR, TASK_TYPE_AR, PROMISE_STATUS_AR, COLLECTION_STATUS_AR } from '@/lib/format';
import { friendlyApiError } from '@/lib/errors';
import { contactLinks } from '@/lib/contact';
import { PageHeader } from '@/components/app-shell';
import { MessageTemplateDialog } from '@/components/message-template-dialog';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Money, Pagination, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { Table, THead, TRow, TD } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsPanel } from '@/components/ui/tabs';
import { CustomerFormDialog } from '@/components/customer-form-dialog';

/* ──────────────────────────────────────────── Types ───────────────────────────────────── */

interface Customer360 {
  id: string;
  externalCustomerCode: string;
  accountNumber: string | null;
  name: string;
  tradeName: string | null;
  phonePrimary: string | null;
  phoneSecondary: string | null;
  whatsapp: string | null;
  region: string | null;
  address: string | null;
  branch: { id: string; name: string } | null;
  customerType: string | null;
  status: string;
  relationshipStartDate: string | null;
  notes: string | null;
  createdAt: string;
  balances: {
    currency: string;
    accountingBalance: number;
    declaredBalance: number | null;
    openingDebit: number;
    openingCredit: number;
    lastImport: { jobId: string; at: string; file: string } | null;
    updatedAt: string;
  }[];
  currentCollector: {
    collectorId: string;
    name: string;
    since: string;
  } | null;
  assignmentHistoryCount: number;
  creditPolicy: CreditPolicy | null;
  creditLimits: CreditLimit[];
  latestScore: Record<string, unknown> | null;
  pendingDuplicateAlerts: number;
  counts: {
    importedTxns: number;
    followups: number;
    promises: number;
    collections: number;
    tasks: number;
  };
}

interface StatementResponse {
  currency: string;
  openingBalance: number;
  periodStartBalance: number;
  currentBalance: number;
  periodEndBalance: number;
  equationClosed: boolean;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: {
    date: string;
    documentType: string;
    documentNumber: string;
    description: string;
    reference: string;
    debit: number;
    credit: number;
    runningBalance: number;
  }[];
}

interface TimelineResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: {
    at: string;
    type: string;
    title: string;
    details?: Record<string, unknown>;
  }[];
}

interface FollowupItem {
  id: string;
  followupAt: string;
  notes: string | null;
  nextFollowupDate: string | null;
  expectedAmount: number | null;
  expectedCurrency: string | null;
  type: { name: string };
  result: { name: string };
  user: { fullName: string };
  createdAt: string;
}

interface PromiseItem {
  id: string;
  promiseDate: string;
  dueDate: string;
  expectedAmount: number;
  currencyCode: string;
  status: string;
  statusReason: string | null;
  fulfilledAmount: number | null;
  notes: string | null;
  collector: { user: { fullName: string } };
  createdAt: string;
}

interface CollectionItem {
  id: string;
  currencyCode: string;
  amount: number;
  collectedAt: string;
  status: string;
  receiptNumber: string | null;
  referenceNumber: string | null;
  notes: string | null;
  collector: { user: { fullName: string } };
  method: { name: string };
  branch: { name: string } | null;
  createdAt: string;
}

interface PaginatedResponse<T> {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: T[];
  totalsByCurrency?: Record<string, number>;
}

interface ReservationItem {
  id: string;
  itemName: string;
  itemType: string | null;
  quantity: string | number | null;
  unit: string | null;
  unitPrice: string | number | null;
  totalAmount: string | number | null;
  issuedQty: string | number;
  remainingQty: string | number | null;
  currencyCode: string;
  status: string;
  warehouse: string | null;
  documentNumber: string | null;
  notes: string | null;
  reservedAt: string;
  expiresAt: string | null;
}

interface CustomerAccountGroupMember {
  id: string;
  externalCustomerCode: string;
  name: string;
  balances: { currencyCode: string; accountingBalance: string | number }[];
}

interface CustomerAccountGroup {
  role: 'standalone' | 'primary' | 'child';
  primary: CustomerAccountGroupMember | null;
  children: CustomerAccountGroupMember[];
  aggregateBalances: { currency: string; balance: number }[];
}

interface CustomerSearchResponse {
  items: { id: string; externalCustomerCode: string; name: string; balances: { currency: string; balance: number }[] }[];
}

interface CreditPolicy {
  allowCreditSale: boolean;
  allowPurchaseWithDebt: boolean;
  defaultPaymentDays: number | null;
  creditLimitAmount: number | string | null;
  creditLimitCurrency: string | null;
  creditStatus: string;
  restrictionReason: string | null;
}

interface CreditLimit {
  id: string;
  currencyCode: string;
  amount: number;
  effectiveFrom: string;
  approvedAt: string;
  approver: { fullName: string };
  used: number;
  available: number;
  usagePercent: number;
}

interface ReservationUnit {
  id: string;
  code: string;
  nameAr: string;
  weightKg: number | null;
}

interface RiskFactor {
  label: string;
  points: number;
  text: string;
}

interface RiskResponse {
  customerId: string;
  customerCode: string;
  customerName: string;
  score: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reasons: {
    factors: Record<string, RiskFactor>;
    perCurrency: {
      currency: string | null;
      score: number;
      riskLevel: string;
      factors: Record<string, RiskFactor>;
    }[];
  };
  computedAt: string;
}

interface CustomerTaskItem {
  id: string;
  customerId: string;
  customerName: string;
  customerCode: string | null;
  taskType: string;
  priority: number;
  priorityReason: string;
  dueDate: string;
  status: string;
  expectedAmount: number | null;
  expectedCurrency: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
}

interface AssignmentResponse {
  assignment: {
    collectorId: string;
    collectorName: string;
    since: string;
    reason: string | null;
  } | null;
  collectors: { id: string; name: string }[];
}

/* ──────────────────────────────── Status Helpers ──────────────────────────────────── */

const TIMELINE_COLORS: Record<string, string> = {
  customer_created: 'bg-pine-100 text-pine-700 dark:bg-pine-900/30 dark:text-pine-200',
  balance_snapshot: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200',
  assignment: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
  followup: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-200',
  payment_promise: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-200',
  collection: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200',
  collection_reversal: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200',
};

const TIMELINE_LABELS: Record<string, string> = {
  customer_created: 'إنشاء العميل',
  balance_snapshot: 'تحديث الرصيد',
  assignment: 'إسناد',
  followup: 'متابعة',
  payment_promise: 'وعد سداد',
  collection: 'تحصيل',
  collection_reversal: 'عكس تحصيل',
};

const TIMELINE_DETAIL_LABELS: Record<string, string> = {
  currency: 'العملة', balance: 'الرصيد', from: 'من', to: 'إلى', reason: 'السبب',
  notes: 'الملاحظات', nextFollowupDate: 'المتابعة التالية', collector: 'المحصل',
  statusReason: 'سبب الحالة', old: 'قبل', new: 'بعد',
};

function timelineValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return fmtMoney(value);
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => `${TIMELINE_DETAIL_LABELS[key] ?? key}: ${timelineValue(nested)}`)
      .join('، ');
  }
  return String(value);
}

function TimelineDetails({ details }: { details: Record<string, unknown> }) {
  return (
    <dl className="mt-2 grid gap-x-4 gap-y-1 rounded-lg bg-concrete-50 p-3 text-xs sm:grid-cols-2 dark:bg-white/5">
      {Object.entries(details).map(([key, value]) => (
        <div key={key} className="flex min-w-0 gap-2">
          <dt className="shrink-0 text-concrete-500">{TIMELINE_DETAIL_LABELS[key] ?? key}:</dt>
          <dd className="break-words text-iron-800 dark:text-concrete-200" dir="auto">{timelineValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function timelineColor(type: string) {
  if (type.startsWith('audit:')) return 'bg-concrete-100 text-concrete-600 dark:bg-white/10 dark:text-concrete-300';
  return TIMELINE_COLORS[type] ?? 'bg-concrete-100 text-concrete-600 dark:bg-white/10 dark:text-concrete-300';
}

function promiseStatusBadge(s: string) {
  const tones: Record<string, string> = {
    fulfilled: 'pine', partially_fulfilled: 'pine',
    upcoming: 'neutral', due_today: 'hazard',
    unfulfilled: 'debt', postponed: 'credit', cancelled_approved: 'neutral',
  };
  return tones[s] ?? 'neutral';
}

function reservationStatusBadge(s: string) {
  const tones: Record<string, string> = {
    open: 'neutral', partial: 'hazard', completed: 'pine', cancelled: 'debt',
  };
  return tones[s] ?? 'neutral';
}

function collectionStatusBadge(s: string) {
  const tones: Record<string, string> = {
    approved: 'pine', matched: 'pine',
    recorded: 'neutral', handed_to_cashier: 'credit',
    reversed: 'debt',
  };
  return tones[s] ?? 'neutral';
}

/* ──────────────────────────────── Main Page ──────────────────────────────────────── */

export default function Customer360Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const can = useCan();
  const canRead = can('customers.read');
  const canBalances = can('balances.read');
  const canRisk = can('risk.read');
  const canTasks = can('tasks.manage');
  const canTransfer = can('customers.transfer');
  const canWrite = can('customers.write');
  const canReservationsRead = can('reservations.read');
  const canReservationsCreate = can('reservations.create');
  const canReservationsDeliver = can('reservations.deliver');
  const canReservationsCancel = can('reservations.cancel');
  const canCreditOverride = can('credit.override');
  const qc = useQueryClient();

  const [tab, setTab] = useState(searchParams.get('tab') ?? 'overview');
  const [messageChannel, setMessageChannel] = useState<'whatsapp' | 'sms' | null>(null);
  const [editCustomerOpen, setEditCustomerOpen] = useState(false);

  const setTabSafe = (v: string) => {
    setTab(v);
    router.replace(`/customers/${id}?tab=${v}`, { scroll: false });
  };

  /* ──────── Customer 360 query ──────── */
  const customer = useQuery<Customer360>({
    queryKey: ['customer360', id],
    queryFn: () => api<Customer360>(`/customers/${id}`),
    enabled: canRead,
  });

  /* ──────── Statement queries (lazy per tab) ──────── */
  const [stmtCurrency, setStmtCurrency] = useState('YER');
  const [stmtPage, setStmtPage] = useState(1);
  const [stmtFromDate, setStmtFromDate] = useState('');
  const [stmtToDate, setStmtToDate] = useState('');
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const [pdfTemplate, setPdfTemplate] = useState<'classic' | 'branded'>('classic');
  const statementParams = () => {
    const params = new URLSearchParams({ currency: stmtCurrency });
    if (stmtFromDate) params.set('fromDate', stmtFromDate);
    if (stmtToDate) params.set('toDate', stmtToDate);
    return params;
  };
  const statement = useQuery<StatementResponse>({
    queryKey: ['statement', id, stmtCurrency, stmtFromDate, stmtToDate, stmtPage],
    queryFn: () => {
      const params = statementParams();
      params.set('page', String(stmtPage)); params.set('limit', '50');
      return api<StatementResponse>(`/customers/${id}/statement?${params.toString()}`);
    },
    enabled: canRead && canBalances && tab === 'statement',
    retry: false,
  });

  useEffect(() => () => {
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
  }, [pdfPreviewUrl]);
  const accountGroup = useQuery<CustomerAccountGroup>({
    queryKey: ['customer-account-group', id],
    queryFn: () => api<CustomerAccountGroup>(`/customers/${id}/account-group`),
    enabled: canRead,
  });
  const [linkAccountOpen, setLinkAccountOpen] = useState(false);
  const [linkAccountSearch, setLinkAccountSearch] = useState('');
  const [selectedLinkedAccounts, setSelectedLinkedAccounts] = useState<Record<string, CustomerSearchResponse['items'][number]>>({});
  const linkedCandidates = useQuery<CustomerSearchResponse>({
    queryKey: ['customer-link-candidates', linkAccountSearch, customer.data?.customerType],
    queryFn: () => api<CustomerSearchResponse>(`/customers?search=${encodeURIComponent(linkAccountSearch)}&limit=10${customer.data?.customerType === 'advance' ? '&accountClass=advance' : ''}`),
    enabled: linkAccountOpen && linkAccountSearch.trim().length >= 2,
  });
  const linkAccount = useMutation({
    mutationFn: (childCustomerIds: string[]) => api(`/customers/${id}/account-group/children/bulk`, {
      method: 'POST', body: JSON.stringify({ childCustomerIds }),
    }),
    onSuccess: () => {
      toast('تم ربط الحساب الفرعي مع إبقاء بياناته وحركاته مستقلة', 'ok');
      setLinkAccountOpen(false);
      setLinkAccountSearch('');
      setSelectedLinkedAccounts({});
      qc.invalidateQueries({ queryKey: ['customer-account-group'] });
    },
    onError: (error: Error) => toast(error.message, 'err'),
  });
  const toggleLinkedAccount = (item: CustomerSearchResponse['items'][number]) => setSelectedLinkedAccounts((current) => {
    const next = { ...current };
    if (next[item.id]) delete next[item.id]; else next[item.id] = item;
    return next;
  });
  const unlinkAccount = useMutation({
    mutationFn: (childCustomerId: string) => api(`/customers/${id}/account-group/children/${childCustomerId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('تم فك الارتباط وبقي الحساب الفرعي مستقلًا دون تغيير حركاته', 'ok');
      qc.invalidateQueries({ queryKey: ['customer-account-group'] });
    },
    onError: (error: Error) => toast(error.message, 'err'),
  });

  const [creditOpen, setCreditOpen] = useState(false);
  const [creditForm, setCreditForm] = useState({
    allowCreditSale: false,
    allowPurchaseWithDebt: false,
    defaultPaymentDays: '',
    creditLimitAmount: '',
    creditLimitCurrency: 'YER',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    limitReason: '',
    creditStatus: 'open',
    restrictionReason: '',
  });
  const openCreditPolicy = () => {
    const policy = customer.data?.creditPolicy;
    const selectedLimit = customer.data?.creditLimits[0];
    setCreditForm({
      allowCreditSale: policy?.allowCreditSale ?? false,
      allowPurchaseWithDebt: policy?.allowPurchaseWithDebt ?? false,
      defaultPaymentDays: policy?.defaultPaymentDays == null ? '' : String(policy.defaultPaymentDays),
      creditLimitAmount: selectedLimit ? String(selectedLimit.amount) : '',
      creditLimitCurrency: selectedLimit?.currencyCode ?? customer.data?.balances[0]?.currency ?? 'YER',
      effectiveFrom: selectedLimit?.effectiveFrom?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      limitReason: '',
      creditStatus: policy?.creditStatus ?? 'open',
      restrictionReason: policy?.restrictionReason ?? '',
    });
    setCreditOpen(true);
  };
  const selectCreditCurrency = (currencyCode: string) => {
    const limit = customer.data?.creditLimits.find((item) => item.currencyCode === currencyCode);
    setCreditForm((value) => ({
      ...value, creditLimitCurrency: currencyCode,
      creditLimitAmount: limit ? String(limit.amount) : '',
      effectiveFrom: limit?.effectiveFrom?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      limitReason: '',
    }));
  };
  const creditMut = useMutation({
    mutationFn: async () => {
      await api(`/customers/${id}/credit-policy`, { method: 'PATCH', body: JSON.stringify({
        allowCreditSale: creditForm.allowCreditSale,
        allowPurchaseWithDebt: creditForm.allowPurchaseWithDebt,
        defaultPaymentDays: creditForm.defaultPaymentDays === '' ? null : Number(creditForm.defaultPaymentDays),
        creditStatus: creditForm.creditStatus,
        restrictionReason: creditForm.restrictionReason.trim() || null,
      }) });
      if (creditForm.creditLimitAmount !== '') {
        await api(`/customers/${id}/credit-limits/${creditForm.creditLimitCurrency}`, {
          method: 'PATCH', body: JSON.stringify({
            amount: Number(creditForm.creditLimitAmount), effectiveFrom: creditForm.effectiveFrom,
            reason: creditForm.limitReason.trim() || undefined,
          }),
        });
      }
    },
    onSuccess: () => {
      toast('تم تحديث سياسة الائتمان ودرجة المخاطر', 'ok');
      setCreditOpen(false);
      qc.invalidateQueries({ queryKey: ['customer360', id] });
      qc.invalidateQueries({ queryKey: ['customer360-risk', id] });
    },
    onError: (error: Error) => toast(error.message, 'err'),
  });

  useEffect(() => {
    if (!customer.data?.balances.length) return;
    if (!customer.data.balances.some((b) => b.currency === stmtCurrency)) {
      setStmtCurrency(customer.data.balances[0].currency);
      setStmtPage(1);
    }
  }, [customer.data, stmtCurrency]);

  /* ──────── Timeline queries ──────── */
  const [tlPage, setTlPage] = useState(1);
  const timeline = useQuery<TimelineResponse>({
    queryKey: ['timeline', id, tlPage],
    queryFn: () => api<TimelineResponse>(`/customers/${id}/timeline?page=${tlPage}&limit=50`),
    enabled: canRead && tab === 'timeline',
  });

  /* ──────── Followups ──────── */
  const [fuPage, setFuPage] = useState(1);
  const followups = useQuery<PaginatedResponse<FollowupItem>>({
    queryKey: ['followups', id, fuPage],
    queryFn: () => api<PaginatedResponse<FollowupItem>>(
      `/followups?customerId=${id}&page=${fuPage}&limit=25`,
    ),
    enabled: canRead && tab === 'followups',
  });

  /* ──────── Promises ──────── */
  const [prPage, setPrPage] = useState(1);
  const promises = useQuery<PaginatedResponse<PromiseItem>>({
    queryKey: ['promises', id, prPage],
    queryFn: () => api<PaginatedResponse<PromiseItem>>(
      `/payment-promises?customerId=${id}&page=${prPage}&limit=25`,
    ),
    enabled: canRead && tab === 'promises',
  });

  /* ──────── Collections ──────── */
  const [coPage, setCoPage] = useState(1);
  const collections = useQuery<PaginatedResponse<CollectionItem>>({
    queryKey: ['collections', id, coPage],
    queryFn: () => api<PaginatedResponse<CollectionItem>>(
      `/collections?customerId=${id}&page=${coPage}&limit=25`,
    ),
    enabled: canRead && tab === 'collections',
  });

  /* ──────── Reservations (PR-F) ──────── */
  const reservations = useQuery<ReservationItem[]>({
    queryKey: ['reservations', id],
    queryFn: () => api<ReservationItem[]>(`/reservations?customerId=${id}`),
    enabled: canReservationsRead && tab === 'reservations',
  });

  const [createResOpen, setCreateResOpen] = useState(false);
  const [issueRes, setIssueRes] = useState<ReservationItem | null>(null);
  const reservationUnits = useQuery<ReservationUnit[]>({
    queryKey: ['reservation-units'],
    queryFn: () => api<ReservationUnit[]>('/reservations/units'),
    enabled: canReservationsCreate && createResOpen,
    staleTime: 5 * 60_000,
  });

  const createResMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/reservations', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      toast('تم إنشاء الحجز بنجاح', 'ok');
      setCreateResOpen(false);
      qc.invalidateQueries({ queryKey: ['reservations', id] });
      qc.invalidateQueries({ queryKey: ['reservations-summary'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const issueResMut = useMutation({
    mutationFn: ({ resId, qty }: { resId: string; qty: number }) =>
      api(`/reservations/${resId}/issue`, { method: 'POST', body: JSON.stringify({ qty }) }),
    onSuccess: () => {
      toast('تم صرف الكمية بنجاح', 'ok');
      setIssueRes(null);
      qc.invalidateQueries({ queryKey: ['reservations', id] });
      qc.invalidateQueries({ queryKey: ['reservations-summary'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const cancelResMut = useMutation({
    mutationFn: (resId: string) => api(`/reservations/${resId}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      toast('تم إلغاء الحجز', 'ok');
      qc.invalidateQueries({ queryKey: ['reservations', id] });
      qc.invalidateQueries({ queryKey: ['reservations-summary'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const [resForm, setResForm] = useState({
    itemName: '', itemType: '', quantity: '', unitId: '', unitPrice: '',
    currencyCode: 'YER', warehouse: '', documentNumber: '', notes: '', expiresAt: '',
    overrideReason: '',
  });
  const resFormValid = resForm.itemName.trim() !== '' && resForm.unitId !== ''
    && Number(resForm.quantity) > 0 && Number(resForm.unitPrice) > 0;

  const [issueQty, setIssueQty] = useState('');

  /* ──────── Risk score (PR 4) ──────── */
  const risk = useQuery<RiskResponse>({
    queryKey: ['customer360-risk', id],
    queryFn: () => api<RiskResponse>(`/customers/${id}/risk`),
    enabled: canRead && canRisk,
    retry: false,
  });

  /* ──────── Customer open tasks (PR 5) ──────── */
  const customerTasks = useQuery<CustomerTaskItem[]>({
    queryKey: ['customer360-tasks', id],
    queryFn: () => api<CustomerTaskItem[]>(`/tasks/by-customer/${id}`),
    enabled: canRead && canTasks,
    retry: false,
  });

  /* ──────── Task completion (PR 9) ──────── */
  const [completeTask, setCompleteTask] = useState<CustomerTaskItem | null>(null);
  const [completeTaskId, setCompleteTaskId] = useState<string | null>(searchParams.get('complete'));
  useEffect(() => {
    if (completeTaskId && !completeTask && customerTasks.data) {
      const t = customerTasks.data.find(x => x.id === completeTaskId) ?? null;
      if (t) setCompleteTask(t);
      else setCompleteTaskId(null);
    }
  }, [completeTaskId, completeTask, customerTasks.data]);
  const completeMut = useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: Record<string, unknown> }) =>
      api(`/tasks/${taskId}/complete`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setCompleteTask(null);
      qc.invalidateQueries({ queryKey: ['customer360-tasks', id] });
      qc.invalidateQueries({ queryKey: ['customer360', id] });
      qc.invalidateQueries({ queryKey: ['tasks-today'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  /* ──────── Assignment (إسناد/فك إسناد) ──────── */
  const [selCollector, setSelCollector] = useState('');
  const assignment = useQuery<AssignmentResponse>({
    queryKey: ['customer360-assignment', id],
    queryFn: () => api<AssignmentResponse>(`/customers/${id}/assignment`),
    enabled: canRead,
    retry: false,
  });
  const refreshAfterAssignment = () => {
    qc.invalidateQueries({ queryKey: ['customer360', id] });
    qc.invalidateQueries({ queryKey: ['customer360-assignment', id] });
    qc.invalidateQueries({ queryKey: ['customer360-tasks', id] });
    qc.invalidateQueries({ queryKey: ['tasks-today'] });
  };
  const assignMut = useMutation({
    mutationFn: (collectorId: string) =>
      api(`/customers/${id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ collectorId, reason: 'إسناد من Customer360' }),
      }),
    onSuccess: () => {
      setSelCollector('');
      refreshAfterAssignment();
    },
  });
  const unassignMut = useMutation({
    mutationFn: () => api(`/customers/${id}/unassign`, { method: 'POST' }),
    onSuccess: refreshAfterAssignment,
  });

  /* ──────── CSV Export ──────── */
  const exportCsv = () => {
    if (statement.data) {
      const headers = ['التاريخ', 'نوع المستند', 'رقم المستند', 'البيان', 'المرجع', 'مدين', 'دائن', 'الرصيد الجاري'];
      const openingDate = stmtFromDate || statement.data.items[0]?.date || '';
      const rows = [[openingDate, '', '', 'الرصيد الافتتاحي', '', '', '', statement.data.periodStartBalance], ...statement.data.items.map(r => [
        r.date, r.documentType, r.documentNumber, r.description, r.reference,
        r.debit || '', r.credit || '', r.runningBalance,
      ])];
      const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\r\n');
      const BOM = '\uFEFF';
      const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(BOM + csv);
      const link = document.createElement('a');
      link.href = dataUri;
      link.download = `statement-${stmtCurrency}-${stmtPage}.csv`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => document.body.removeChild(link), 200);
    } else if (c?.balances?.length) {
      const headers = ['العملة', 'الرصيد المحاسبي', 'الرصيد المعلنه', 'الديون الافتتاحية', 'الدائن الافتتاحي'];
      const rows = c.balances.map(b => [
        CCY_AR[b.currency] ?? b.currency, b.accountingBalance, b.declaredBalance ?? '',
        b.openingDebit, b.openingCredit,
      ]);
      const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\r\n');
      const BOM = '\uFEFF';
      const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(BOM + csv);
      const link = document.createElement('a');
      link.href = dataUri;
      link.download = `balances-${c.name}.csv`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => document.body.removeChild(link), 200);
    }
  };

  const exportStatementPdf = async () => {
    setPdfDownloading(true);
    try {
      await downloadApiFile(
        `/customers/${id}/statement.pdf?${statementParams().toString()}&template=${pdfTemplate}`,
        `statement-${c?.externalCustomerCode ?? id}-${stmtCurrency}-${pdfTemplate}.pdf`,
      );
      toast('تم تنزيل كشف الحساب PDF', 'ok');
    } catch (error) {
      toast(friendlyApiError(error), 'err');
    } finally {
      setPdfDownloading(false);
    }
  };

  const previewStatementPdf = async () => {
    setPdfPreviewLoading(true);
    try {
      const blob = await apiFileBlob(`/customers/${id}/statement.pdf?${statementParams().toString()}&template=${pdfTemplate}`);
      setPdfPreviewUrl(URL.createObjectURL(blob));
    } catch (error) {
      toast(friendlyApiError(error), 'err');
    } finally {
      setPdfPreviewLoading(false);
    }
  };

  /* ──────── Permission gate ──────── */
  if (!canRead) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية عرض بيانات العميل" />
      </Card>
    );
  }

  const c = customer.data;
  const links = c ? contactLinks(c.phonePrimary) : null;
  const whatsappLink = c ? contactLinks(c.whatsapp ?? c.phonePrimary)?.whatsapp : null;
  const primaryDebt = c?.balances
    .filter((b) => Number(b.accountingBalance) > 0)
    .sort((a, b) => Number(b.accountingBalance) - Number(a.accountingBalance))[0];
  const isLoading = customer.isLoading;
  const err = customer.error;

  return (
    <div className="space-y-5">
      {/* Header */}
      <PageHeader
        title={isLoading ? '...' : c?.name ?? 'الحساب'}
        action={
          c ? (
            <div className="flex items-center gap-3">
              {canWrite && <Button variant="secondary" onClick={() => setEditCustomerOpen(true)}><Pencil className="h-4 w-4" />تعديل البيانات</Button>}
              <Link href={c.customerType === 'advance' ? '/advances' : '/customers'} className="text-sm text-pine-700 hover:underline dark:text-pine-100">
                ← العودة إلى {c.customerType === 'advance' ? 'السلف' : 'العملاء'}
              </Link>
            </div>
          ) : undefined
        }
      />
      <CustomerFormDialog
        open={editCustomerOpen}
        onClose={() => setEditCustomerOpen(false)}
        customer={c}
        defaultCustomerType={c?.customerType ?? 'customer'}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['customer360', id] });
          qc.invalidateQueries({ queryKey: ['customers'] });
          toast('تم حفظ بيانات الحساب', 'ok');
        }}
      />

      {/* Customer Info Bar */}
      {c && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="font-semibold text-iron-900 dark:text-concrete-100">{c.name}</span>
            {c.externalCustomerCode && (
              <span className="text-concrete-500" dir="ltr">{c.externalCustomerCode}</span>
            )}
            <Badge tone={c.status === 'active' ? 'pine' : 'neutral'}>
              {c.status === 'active' ? 'نشط' : 'غير نشط'}
            </Badge>
            {c.phonePrimary && (
              <span className="flex items-center gap-1 text-concrete-600 dark:text-concrete-400">
                <Phone className="h-3.5 w-3.5" /> {c.phonePrimary}
              </span>
            )}
            {c.region && (
              <span className="flex items-center gap-1 text-concrete-600 dark:text-concrete-400">
                <MapPin className="h-3.5 w-3.5" /> {c.region}
              </span>
            )}
            {c.branch && (
              <span className="flex items-center gap-1 text-concrete-600 dark:text-concrete-400">
                <Building2 className="h-3.5 w-3.5" /> {c.branch?.name ?? '—'}
              </span>
            )}
            {c.currentCollector && (
              <span className="flex items-center gap-1 text-concrete-600 dark:text-concrete-400">
                <UserCheck className="h-3.5 w-3.5" /> {c.currentCollector.name}
              </span>
            )}
            {c.pendingDuplicateAlerts > 0 && (
              <Badge tone="hazard">
                <AlertTriangle className="h-3 w-3" /> {c.pendingDuplicateAlerts} تشابه
              </Badge>
            )}
          </div>
          {(links || whatsappLink) && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-concrete-100 pt-4 dark:border-white/10">
              {links && (
                <>
                  <a href={links.tel} className="inline-flex items-center gap-2 rounded-lg bg-pine-700 px-4 py-2 text-sm font-medium text-white hover:bg-pine-800">
                    <Phone className="h-4 w-4" aria-hidden /> اتصال
                  </a>
                  <button type="button" onClick={() => setMessageChannel('sms')} className="inline-flex items-center gap-2 rounded-lg border border-concrete-200 bg-white px-4 py-2 text-sm font-medium text-iron-900 hover:bg-concrete-100 dark:border-white/10 dark:bg-iron-800 dark:text-concrete-100">
                    <MessageSquare className="h-4 w-4" aria-hidden /> رسالة نصية
                  </button>
                </>
              )}
              {whatsappLink && (
                <button type="button" onClick={() => setMessageChannel('whatsapp')} className="inline-flex items-center gap-2 rounded-lg bg-credit-600 px-4 py-2 text-sm font-medium text-white hover:bg-credit-700">
                  <MessageCircle className="h-4 w-4" aria-hidden /> واتساب
                </button>
              )}
            </div>
          )}
          <MessageTemplateDialog
            open={messageChannel !== null}
            onClose={() => setMessageChannel(null)}
            initialChannel={messageChannel ?? 'whatsapp'}
            customerId={c.id}
            customerName={c.name}
            customerCode={c.externalCustomerCode}
            phone={c.phonePrimary}
            whatsapp={c.whatsapp}
            balance={primaryDebt ? Number(primaryDebt.accountingBalance) : null}
            currency={primaryDebt?.currency ?? null}
            collectorName={c.currentCollector?.name ?? null}
          />
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={tab} onChange={setTabSafe}>
        <TabsList>
          <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
          <TabsTrigger value="statement">كشف الحساب</TabsTrigger>
          <TabsTrigger value="timeline">الجدول الزمني</TabsTrigger>
          <TabsTrigger value="followups" badge={c?.counts.followups}>المتابعات</TabsTrigger>
          <TabsTrigger value="promises" badge={c?.counts.promises}>الوعود</TabsTrigger>
          <TabsTrigger value="collections" badge={c?.counts.collections}>التحصيلات</TabsTrigger>
          {canReservationsRead && <TabsTrigger value="reservations" badge={reservations.data?.length}>حجوزات البضاعة</TabsTrigger>}
        </TabsList>

        {/* ──────────────── Overview Tab ──────────────── */}
        <TabsPanel value="overview">
          <DataState
            isLoading={isLoading} isError={!!err} error={err} onRetry={() => customer.refetch()}
            isEmpty={!c} emptyTitle="العميل غير موجود"
          >
            {c && (
              <div className="space-y-5">
                {/* Stats Cards */}
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    label="الرصيد الحالي"
                    value={
                      c.balances.length > 0
                        ? <div className="space-y-1">{c.balances.map(b => <div key={b.currency}><Money value={b.accountingBalance} currency={b.currency} signed /></div>)}</div>
                        : <span className="text-xs font-normal text-concrete-400">لا توجد أرصدة لهذا السجل</span>
                    }
                  />
                  <StatCard label="نوع العميل" value={c.customerType ?? '—'} />
                  <StatCard label="تاريخ بدء العلاقة" value={c.relationshipStartDate ? fmtDate(c.relationshipStartDate) : '—'} />
                  <StatCard label="تاريخ الإنشاء" value={fmtDateTime(c.createdAt)} />
                </div>

                {accountGroup.data && (
                  <Card className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Link2 className="h-4 w-4 text-pine-700" />
                          <h3 className="text-sm font-semibold">الحسابات الرئيسية والفرعية</h3>
                          <Badge tone="pine">
                            {accountGroup.data.role === 'primary' ? 'حساب رئيسي' : accountGroup.data.role === 'child' ? 'حساب فرعي' : 'حساب مستقل'}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-concrete-500">الربط للعرض والتجميع فقط؛ كل حساب وحركاته يبقيان مستقلين.</p>
                      </div>
                      {canWrite && accountGroup.data.role !== 'child' && (
                        <Button variant="secondary" onClick={() => setLinkAccountOpen(true)}><Link2 className="h-4 w-4" /> ربط حساب فرعي</Button>
                      )}
                    </div>
                    {accountGroup.data.aggregateBalances.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {accountGroup.data.aggregateBalances.map((balance) => (
                          <div key={balance.currency} className="rounded-lg bg-pine-50 px-3 py-2 text-sm dark:bg-pine-900/20">
                            <span className="ml-2 text-xs text-concrete-500">الرصيد المجمع</span>
                            <Money value={balance.balance} currency={balance.currency} signed />
                          </div>
                        ))}
                      </div>
                    )}
                    {accountGroup.data.role === 'child' && accountGroup.data.primary && (
                      <div className="mt-4 rounded-lg border border-concrete-100 p-3 dark:border-white/10">
                        <p className="text-xs text-concrete-500">الحساب الرئيسي</p>
                        <Link href={`/customers/${accountGroup.data.primary.id}`} className="mt-1 inline-block font-semibold text-pine-700 hover:underline">
                          {accountGroup.data.primary.externalCustomerCode} — {accountGroup.data.primary.name}
                        </Link>
                      </div>
                    )}
                    {accountGroup.data.children.length > 0 && (
                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {accountGroup.data.children.map((child) => (
                          <div key={child.id} className="rounded-lg border border-concrete-100 p-3 dark:border-white/10">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <Link href={`/customers/${child.id}`} className="font-semibold text-pine-700 hover:underline">{child.externalCustomerCode} — {child.name}</Link>
                                <div className="mt-2 space-y-1 text-xs">{child.balances.map((balance) => <div key={balance.currencyCode}><Money value={Number(balance.accountingBalance)} currency={balance.currencyCode} signed /></div>)}</div>
                              </div>
                              {canWrite && <button type="button" title="فك الارتباط" onClick={() => unlinkAccount.mutate(child.id)} className="rounded p-1 text-concrete-400 hover:bg-red-50 hover:text-red-600"><Unlink className="h-4 w-4" /></button>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                )}

                <Dialog open={linkAccountOpen} onClose={() => setLinkAccountOpen(false)} title="ربط حساب فرعي">
                  <div className="space-y-4">
                    <p className="text-sm text-concrete-600 dark:text-concrete-400">يمكن تحديد عدة حسابات عبر عمليات بحث متتالية. يبقى التحديد محفوظًا عند تغيير كلمة البحث، ولن تُنقل أو تُدمج أي حركة.</p>
                    {Object.keys(selectedLinkedAccounts).length > 0 && (
                      <div className="rounded-lg bg-pine-50 p-3 dark:bg-pine-900/20">
                        <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                          <span>المحدد: {Object.keys(selectedLinkedAccounts).length}</span>
                          <button type="button" onClick={() => setSelectedLinkedAccounts({})} className="text-xs text-debt-600">مسح التحديد</button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {Object.values(selectedLinkedAccounts).map((item) => (
                            <button key={item.id} type="button" onClick={() => toggleLinkedAccount(item)} className="rounded-full bg-white px-2.5 py-1 text-xs shadow-sm dark:bg-iron-800">
                              {item.externalCustomerCode} — {item.name} ×
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <Field label="البحث عن الحسابات الفرعية">
                      <Input value={linkAccountSearch} onChange={(event) => setLinkAccountSearch(event.target.value)} placeholder="مثال: 10005 أو اسم العميل" />
                    </Field>
                    <div className="max-h-72 space-y-2 overflow-auto">
                      {(linkedCandidates.data?.items ?? []).filter((item) => item.id !== id && !accountGroup.data?.children.some((child) => child.id === item.id)).map((item) => (
                        <button key={item.id} type="button" onClick={() => toggleLinkedAccount(item)} className={`flex w-full items-center justify-between rounded-lg border p-3 text-right ${selectedLinkedAccounts[item.id] ? 'border-pine-600 bg-pine-50 dark:bg-pine-900/20' : 'border-concrete-100 hover:bg-pine-50 dark:border-white/10 dark:hover:bg-white/5'}`}>
                          <span><span className="font-semibold">{item.externalCustomerCode}</span><span className="mr-2">{item.name}</span></span>
                          <span className="text-xs text-pine-700">{selectedLinkedAccounts[item.id] ? 'محدد ✓' : 'تحديد'}</span>
                        </button>
                      ))}
                      {linkAccountSearch.trim().length >= 2 && !linkedCandidates.isLoading && !(linkedCandidates.data?.items ?? []).filter((item) => item.id !== id).length && <p className="py-4 text-center text-sm text-concrete-500">لا توجد نتائج مطابقة</p>}
                    </div>
                    <div className="flex justify-end gap-2 border-t border-concrete-100 pt-3 dark:border-white/10">
                      <Button variant="secondary" onClick={() => setLinkAccountOpen(false)}>إلغاء</Button>
                      <Button
                        loading={linkAccount.isPending}
                        disabled={!Object.keys(selectedLinkedAccounts).length}
                        onClick={() => linkAccount.mutate(Object.keys(selectedLinkedAccounts))}
                      >
                        ربط الحسابات المحددة ({Object.keys(selectedLinkedAccounts).length})
                      </Button>
                    </div>
                  </div>
                </Dialog>

                {/* Risk Score (PR 4) */}
                {canRisk && (
                  <RiskCard
                    data={risk.data}
                    isLoading={risk.isLoading}
                    isError={risk.isError}
                    error={risk.error}
                    onRetry={() => risk.refetch()}
                  />
                )}

                <Card className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-iron-900 dark:text-concrete-100">السياسة الائتمانية</h3>
                      {c.creditPolicy ? (
                        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm text-concrete-600 dark:text-concrete-400">
                          <span>الحالة: {c.creditPolicy.creditStatus === 'blocked' ? 'محظور' : c.creditPolicy.creditStatus === 'restricted' ? 'مقيّد' : 'مفتوح'}</span>
                          <span>البيع الآجل: {c.creditPolicy.allowCreditSale ? 'مسموح' : 'غير مسموح'}</span>
                          <span>أيام السداد: {c.creditPolicy.defaultPaymentDays ?? '—'}</span>
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-concrete-500">لم تُحدد سياسة ائتمانية لهذا العميل.</p>
                      )}
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {c.creditLimits.map((limit) => {
                          const pct = Math.max(0, limit.usagePercent);
                          const tone = pct > 100 ? 'bg-red-600 shadow-[0_0_12px_rgba(220,38,38,.9)] animate-pulse'
                            : pct >= 90 ? 'bg-debt-600' : pct >= 70 ? 'bg-hazard-500' : 'bg-credit-600';
                          return <div key={limit.id} className="rounded-lg border border-concrete-100 p-3 dark:border-white/10">
                            <div className="flex items-center justify-between text-xs"><span className="font-bold">{limit.currencyCode}</span><span className="tnum">{fmtMoney(pct)}%</span></div>
                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-concrete-100 dark:bg-white/10"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
                            <div className="mt-2 flex justify-between text-xs text-concrete-500"><span>المستخدم {fmtMoney(limit.used)}</span><span>السقف {fmtMoney(limit.amount)}</span></div>
                            <p className="mt-1 text-[11px] text-concrete-400">ساري من {fmtDate(limit.effectiveFrom)} • {limit.approver.fullName}</p>
                          </div>;
                        })}
                        {!c.creditLimits.length && <p className="text-sm text-concrete-500">لا توجد حدود ائتمان معتمدة حسب العملة.</p>}
                      </div>
                    </div>
                    {canWrite && <Button variant="secondary" onClick={openCreditPolicy}>تعديل السياسة</Button>}
                  </div>
                </Card>

                <Dialog open={creditOpen} onClose={() => setCreditOpen(false)} title="تعديل السياسة الائتمانية">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={creditForm.allowCreditSale} onChange={(e) => setCreditForm((v) => ({ ...v, allowCreditSale: e.target.checked }))} />
                      السماح بالبيع الآجل
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={creditForm.allowPurchaseWithDebt} onChange={(e) => setCreditForm((v) => ({ ...v, allowPurchaseWithDebt: e.target.checked }))} />
                      السماح بالشراء مع وجود مديونية
                    </label>
                    <Field label="حد الائتمان">
                      <Input type="number" min="0" value={creditForm.creditLimitAmount} onChange={(e) => setCreditForm((v) => ({ ...v, creditLimitAmount: e.target.value }))} />
                    </Field>
                    <Field label="عملة الحد">
                      <Select value={creditForm.creditLimitCurrency} onChange={(e) => selectCreditCurrency(e.target.value)}>
                        <option value="YER">ريال يمني</option><option value="SAR">ريال سعودي</option><option value="USD">دولار</option>
                      </Select>
                    </Field>
                    <Field label="تاريخ سريان الحد">
                      <Input type="date" value={creditForm.effectiveFrom} onChange={(e) => setCreditForm((v) => ({ ...v, effectiveFrom: e.target.value }))} />
                    </Field>
                    <Field label="سبب اعتماد أو تغيير الحد">
                      <Input value={creditForm.limitReason} onChange={(e) => setCreditForm((v) => ({ ...v, limitReason: e.target.value }))} />
                    </Field>
                    <Field label="أيام السداد الافتراضية">
                      <Input type="number" min="0" max="3650" value={creditForm.defaultPaymentDays} onChange={(e) => setCreditForm((v) => ({ ...v, defaultPaymentDays: e.target.value }))} />
                    </Field>
                    <Field label="حالة الائتمان">
                      <Select value={creditForm.creditStatus} onChange={(e) => setCreditForm((v) => ({ ...v, creditStatus: e.target.value }))}>
                        <option value="open">مفتوح</option><option value="restricted">مقيّد</option><option value="blocked">محظور</option>
                      </Select>
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="سبب التقييد أو ملاحظة القرار">
                        <Textarea value={creditForm.restrictionReason} onChange={(e) => setCreditForm((v) => ({ ...v, restrictionReason: e.target.value }))} />
                      </Field>
                    </div>
                  </div>
                  <div className="mt-5 flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setCreditOpen(false)}>إلغاء</Button>
                    <Button loading={creditMut.isPending} onClick={() => creditMut.mutate()}>حفظ وتحديث المخاطر</Button>
                  </div>
                </Dialog>

                {/* Open Tasks (PR 5) */}
                {canTasks && (
                  <TasksCard
                    data={customerTasks.data}
                    isLoading={customerTasks.isLoading}
                    isError={customerTasks.isError}
                    error={customerTasks.error}
                    onRetry={() => customerTasks.refetch()}
                    onComplete={setCompleteTask}
                    completeBusyId={completeMut.isPending && completeTask ? completeTask.id : null}
                  />
                )}

                {/* Task completion form (PR 9) */}
                {canTasks && completeTask && (
                  <TaskCompletePanel
                    task={completeTask}
                    busy={completeMut.isPending}
                    error={completeMut.isError ? completeMut.error : null}
                    onCancel={() => setCompleteTask(null)}
                    onSubmit={(body) => completeMut.mutate({ taskId: completeTask.id, body })}
                  />
                )}

                {/* Assignment (إسناد/فك إسناد) */}
                {canRead && (
                  <AssignmentCard
                    data={assignment.data}
                    isLoading={assignment.isLoading}
                    isError={assignment.isError}
                    error={assignment.error}
                    onRetry={() => assignment.refetch()}
                    canManage={canTransfer}
                    selCollector={selCollector}
                    onSelectCollector={setSelCollector}
                    assignBusy={assignMut.isPending}
                    unassignBusy={unassignMut.isPending}
                    assignError={assignMut.isError ? assignMut.error : null}
                    unassignError={unassignMut.isError ? unassignMut.error : null}
                    onAssign={() => { if (selCollector) assignMut.mutate(selCollector); }}
                    onUnassign={() => unassignMut.mutate()}
                  />
                )}

                {/* Detail Grid */}
                <Card className="p-4">
                  <h3 className="mb-3 text-sm font-semibold text-iron-900 dark:text-concrete-100">بيانات العميل</h3>
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    <DetailRow label="الكود" value={c.externalCustomerCode} />
                    <DetailRow label="رقم الحساب" value={c.accountNumber} />
                    <DetailRow label="الاسم التجاري" value={c.tradeName} />
                    <DetailRow label="هاتف أساسي" value={c.phonePrimary} dir="ltr" />
                    <DetailRow label="هاتف ثانوي" value={c.phoneSecondary} dir="ltr" />
                    <DetailRow label="واتساب" value={c.whatsapp} dir="ltr" />
                    <DetailRow label="المنطقة" value={c.region} />
                    <DetailRow label="العنوان" value={c.address} />
                    <DetailRow label="الفرع" value={c.branch?.name} />
                    <DetailRow
                      label="المحصل الحالي"
                      value={c.currentCollector ? `${c.currentCollector.name} (منذ ${fmtDate(c.currentCollector.since)})` : undefined}
                    />
                    <DetailRow label="عدد التحويلات" value={c.assignmentHistoryCount > 0 ? `${c.assignmentHistoryCount} مرة` : undefined} />
                  </dl>
                </Card>

                {/* Balances */}
                {c.balances.length > 0 && (
                  <Card className="p-4">
                    <h3 className="mb-3 text-sm font-semibold text-iron-900 dark:text-concrete-100">الأرصدة</h3>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {c.balances.map(b => (
                        <div key={b.currency} className="rounded-lg border border-concrete-100 p-3 dark:border-white/10">
                          <p className="text-xs text-concrete-500">{CCY_AR[b.currency] ?? b.currency}</p>
                          <span className="text-lg font-bold"><Money value={b.accountingBalance} currency={b.currency} signed /></span>
                          <div className="mt-1 text-xs text-concrete-400">
                            سلف: <Money value={b.openingDebit} /> | دائن: <Money value={b.openingCredit} />
                          </div>
                          {b.lastImport && (
                            <p className="mt-1 text-[10px] text-concrete-400">
                              آخر استيراد: {b.lastImport.file} — {fmtDateTime(b.lastImport.at)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Notes */}
                {c.notes && (
                  <Card className="p-4">
                    <h3 className="mb-2 text-sm font-semibold text-iron-900 dark:text-concrete-100">ملاحظات</h3>
                    <p className="text-sm text-concrete-600 dark:text-concrete-400 whitespace-pre-wrap">{c.notes}</p>
                  </Card>
                )}

                {/* Activity Counts */}
                <Card className="p-4">
                  <h3 className="mb-3 text-sm font-semibold text-iron-900 dark:text-concrete-100">النشاط</h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <CountBadge label="حركات مستوردة" count={c.counts.importedTxns} />
                    <CountBadge label="متابعات" count={c.counts.followups} />
                    <CountBadge label="وعود" count={c.counts.promises} />
                    <CountBadge label="تحصيلات" count={c.counts.collections} />
                    <CountBadge label="مهام" count={c.counts.tasks} />
                  </div>
                </Card>
              </div>
            )}
          </DataState>
        </TabsPanel>

        {/* ──────────────── Statement Tab ──────────────── */}
        <TabsPanel value="statement">
          {!canBalances ? (
            <PermissionNotice message="لا تملك صلاحية عرض الأرصدة (balances.read)" />
          ) : (
            <Card className="report-print">
              <div className="flex flex-wrap items-end gap-3 border-b border-concrete-100 px-4 py-3 dark:border-white/10">
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-concrete-500">العملة</span>
                  <Select
                    value={stmtCurrency}
                    onChange={e => { setStmtCurrency(e.target.value); setStmtPage(1); }}
                  >
                    {Object.entries(CCY_AR).map(([code, name]) => (
                      <option key={code} value={code}>{name} ({code})</option>
                    ))}
                  </Select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-concrete-500">من تاريخ</span>
                  <Input type="date" value={stmtFromDate} max={stmtToDate || undefined} onChange={(event) => { setStmtFromDate(event.target.value); setStmtPage(1); }} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-concrete-500">إلى تاريخ</span>
                  <Input type="date" value={stmtToDate} min={stmtFromDate || undefined} onChange={(event) => { setStmtToDate(event.target.value); setStmtPage(1); }} />
                </label>
                <Button
                  variant="secondary"
                  onClick={exportCsv}
                  className="mr-auto"
                  disabled={!statement.data && !c?.balances?.length}
                >
                  <Download className="h-4 w-4" /> تصدير CSV
                </Button>
                <label className="flex items-center gap-2 text-sm print:hidden">
                  <span className="text-concrete-500">قالب PDF</span>
                  <Select value={pdfTemplate} onChange={(event) => setPdfTemplate(event.target.value as 'classic' | 'branded')}>
                    <option value="branded">الرسمي الملوّن</option>
                    <option value="classic">الكلاسيكي</option>
                  </Select>
                </label>
                <Button variant="secondary" onClick={previewStatementPdf} loading={pdfPreviewLoading} className="print:hidden">
                  <Eye className="h-4 w-4" /> معاينة قبل الطباعة
                </Button>
                <Button variant="secondary" onClick={exportStatementPdf} loading={pdfDownloading} className="print:hidden">
                  <Download className="h-4 w-4" /> تنزيل PDF
                </Button>
              </div>

              <DataState
                isLoading={statement.isLoading}
                isError={statement.isError}
                error={statement.error}
                onRetry={() => statement.refetch()}
                isFetching={statement.isFetching}
                isEmpty={!statement.data}
                emptyTitle="لا توجد حركات"
                emptyHint={`لا توجد حركات بهذه العملة${stmtCurrency ? ` (${CCY_AR[stmtCurrency] ?? stmtCurrency})` : ''}`}
                skeletonClassName="h-64"
              >
                {statement.data && (
                  <>
                    <div className="hidden border-b border-concrete-100 px-4 py-4 text-right print:block">
                      <p className="text-xl font-extrabold text-pine-800">البناء الراقي</p>
                      <p className="mt-1 font-semibold">كشف حساب العميل: {c?.name}</p>
                      <p className="text-xs text-concrete-500">العملة: {stmtCurrency} • تاريخ الطباعة: {new Date().toLocaleDateString('ar-YE')}</p>
                    </div>
                    {/* Summary */}
                    <div className="flex flex-wrap gap-4 border-b border-concrete-100 px-4 py-2 text-xs dark:border-white/10">
                      <span className="text-concrete-500">الرصيد الافتتاحي: <Money value={statement.data.openingBalance} signed /></span>
                      <span className="text-concrete-500">رصيد بداية الفترة: <Money value={statement.data.periodStartBalance} signed /></span>
                      <span className="text-concrete-500">رصيد نهاية الفترة: <Money value={statement.data.periodEndBalance} signed /></span>
                      <span className="font-semibold text-iron-900 dark:text-concrete-100">
                        الرصيد الحالي: <Money value={statement.data.currentBalance} currency={stmtCurrency} signed />
                      </span>
                      <span className="text-concrete-500 ml-auto">{statement.data.total} حركة</span>
                    </div>

                    <Table>
                      <THead cols={['التاريخ', 'نوع المستند', 'الرقم', 'البيان', 'المرجع', 'مدين', 'دائن', 'الرصيد']} />
                      <tbody>
                        <TRow>
                          <TD>{stmtFromDate ? fmtDate(stmtFromDate) : statement.data.items[0]?.date ? fmtDate(statement.data.items[0].date) : '—'}</TD>
                          <TD>—</TD><TD>—</TD>
                          <TD className="font-semibold">الرصيد الافتتاحي</TD>
                          <TD>—</TD><TD>—</TD><TD>—</TD>
                          <TD className="font-semibold"><Money value={statement.data.periodStartBalance} signed /></TD>
                        </TRow>
                        {statement.data.items.map((r, i) => (
                          <TRow key={i}>
                            <TD>{fmtDate(r.date)}</TD>
                            <TD>{r.documentType}</TD>
                            <TD className="font-mono text-xs"><span dir="ltr">{r.documentNumber}</span></TD>
                            <TD className="max-w-[200px] truncate text-xs">{r.description}</TD>
                            <TD className="font-mono text-xs"><span dir="ltr">{r.reference}</span></TD>
                            <TD>{r.debit ? <Money value={r.debit} /> : '—'}</TD>
                            <TD>{r.credit ? <Money value={r.credit} /> : '—'}</TD>
                            <TD className="font-semibold"><Money value={r.runningBalance} signed /></TD>
                          </TRow>
                        ))}
                      </tbody>
                    </Table>
                    {!statement.data.items.length && <p className="px-4 py-3 text-center text-sm text-concrete-500">لا توجد حركات خلال الفترة المحددة؛ يظهر رصيد بداية الفترة فقط.</p>}
                    <Pagination page={statement.data.page} totalPages={statement.data.totalPages} onPage={setStmtPage} />
                    <p className="hidden py-5 text-center font-bold text-debt-600 print:block">كشف غير معتمد ما لم يُختم</p>
                  </>
                )}
              </DataState>
              <Dialog open={!!pdfPreviewUrl} onClose={() => setPdfPreviewUrl(null)} title="معاينة كشف الحساب قبل الطباعة" className="sm:max-w-6xl">
                {pdfPreviewUrl && (
                  <div className="space-y-3">
                    <iframe ref={previewFrame} src={pdfPreviewUrl} title="معاينة كشف الحساب" className="h-[72vh] w-full rounded-lg border border-concrete-200 bg-white" />
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => setPdfPreviewUrl(null)}>إغلاق</Button>
                      <Button variant="secondary" onClick={() => previewFrame.current?.contentWindow?.print()}>طباعة</Button>
                      <Button onClick={exportStatementPdf} loading={pdfDownloading}><Download className="h-4 w-4" />تنزيل PDF</Button>
                    </div>
                  </div>
                )}
              </Dialog>
            </Card>
          )}
        </TabsPanel>

        {/* ──────────────── Timeline Tab ──────────────── */}
        <TabsPanel value="timeline">
          <Card>
            <DataState
              isLoading={timeline.isLoading}
              isError={timeline.isError}
              error={timeline.error}
              onRetry={() => timeline.refetch()}
              isFetching={timeline.isFetching}
              isEmpty={!timeline.data?.items?.length}
              emptyTitle="لا توجد أحداث"
              skeletonClassName="h-64"
            >
              {timeline.data && (
                <>
                  <div className="space-y-3 px-4 py-3">
                    {timeline.data.items.map((ev, i) => (
                      <div key={i} className="flex gap-3">
                        <div className="flex flex-col items-center pt-1">
                          <span className={`inline-block h-3 w-3 rounded-full ${timelineColor(ev.type)}`} />
                          {i < timeline.data!.items.length - 1 && <span className="mt-1 h-full w-px bg-concrete-200 dark:bg-white/10" />}
                        </div>
                        <div className="flex-1 pb-3">
                          <div className="flex items-center gap-2">
                            <Badge className={timelineColor(ev.type)}>
                              {TIMELINE_LABELS[ev.type] ?? (ev.type.startsWith('audit:') ? 'تدقيق' : ev.type.replace(/_/g, ' '))}
                            </Badge>
                            <span className="text-xs text-concrete-400">{fmtDateTime(ev.at)}</span>
                          </div>
                          <p className="mt-1 text-sm text-iron-800 dark:text-concrete-100">{ev.title}</p>
                          {ev.details && <TimelineDetails details={ev.details} />}
                        </div>
                      </div>
                    ))}
                  </div>
                  <Pagination page={timeline.data.page} totalPages={timeline.data.totalPages} onPage={setTlPage} />
                </>
              )}
            </DataState>
          </Card>
        </TabsPanel>

        {/* ──────────────── Follow-ups Tab ──────────────── */}
        <TabsPanel value="followups">
          <Card>
            <DataState
              isLoading={followups.isLoading}
              isError={followups.isError}
              error={followups.error}
              onRetry={() => followups.refetch()}
              isFetching={followups.isFetching}
              isEmpty={!followups.data?.items?.length}
              emptyTitle="لا توجد متابعات"
              skeletonClassName="h-64"
            >
              {followups.data && (
                <>
                  <Table>
                    <THead cols={['التاريخ', 'النوع', 'النتيجة', 'المحصل', 'الملاحظات', 'التاريخ التالي']} />
                    <tbody>
                      {followups.data.items.map(f => (
                        <TRow key={f.id}>
                          <TD>{fmtDateTime(f.followupAt)}</TD>
                          <TD>{f.type?.name ?? '—'}</TD>
                          <TD><Badge tone="pine">{f.result?.name ?? '—'}</Badge></TD>
                          <TD>{f.user.fullName}</TD>
                          <TD className="max-w-[200px] truncate text-xs">{f.notes ?? '—'}</TD>
                          <TD>{f.nextFollowupDate ? fmtDate(f.nextFollowupDate) : '—'}</TD>
                        </TRow>
                      ))}
                    </tbody>
                  </Table>
                  <Pagination page={followups.data.page} totalPages={followups.data.totalPages} onPage={setFuPage} />
                </>
              )}
            </DataState>
          </Card>
        </TabsPanel>

        {/* ──────────────── Promises Tab ──────────────── */}
        <TabsPanel value="promises">
          <Card>
            <DataState
              isLoading={promises.isLoading}
              isError={promises.isError}
              error={promises.error}
              onRetry={() => promises.refetch()}
              isFetching={promises.isFetching}
              isEmpty={!promises.data?.items?.length}
              emptyTitle="لا توجد وعود سداد"
              skeletonClassName="h-64"
            >
              {promises.data && (
                <>
                  <Table>
                    <THead cols={['تاريخ الوعد', 'الاستحقاق', 'المبلغ', 'العملة', 'الحالة', 'المحصل', 'ملاحظات']} />
                    <tbody>
                      {promises.data.items.map(p => (
                        <TRow key={p.id}>
                          <TD>{fmtDate(p.promiseDate)}</TD>
                          <TD>{fmtDate(p.dueDate)}</TD>
                          <TD><Money value={p.expectedAmount} /></TD>
                          <TD>{CCY_AR[p.currencyCode] ?? p.currencyCode}</TD>
                          <TD>
                            <Badge tone={promiseStatusBadge(p.status) as any}>
                              {PROMISE_STATUS_AR[p.status] ?? p.status}
                            </Badge>
                          </TD>
                          <TD>{p.collector?.user?.fullName ?? '—'}</TD>
                          <TD className="max-w-[200px] truncate text-xs">{p.notes ?? '—'}</TD>
                        </TRow>
                      ))}
                    </tbody>
                  </Table>
                  <Pagination page={promises.data.page} totalPages={promises.data.totalPages} onPage={setPrPage} />
                </>
              )}
            </DataState>
          </Card>
        </TabsPanel>

        {/* ──────────────── Collections Tab ──────────────── */}
        <TabsPanel value="collections">
          <Card>
            <DataState
              isLoading={collections.isLoading}
              isError={collections.isError}
              error={collections.error}
              onRetry={() => collections.refetch()}
              isFetching={collections.isFetching}
              isEmpty={!collections.data?.items?.length}
              emptyTitle="لا توجد تحصيلات"
              skeletonClassName="h-64"
            >
              {collections.data && (
                <>
                  {collections.data.totalsByCurrency && Object.keys(collections.data.totalsByCurrency).length > 0 && (
                    <div className="flex flex-wrap gap-4 border-b border-concrete-100 px-4 py-2 text-xs dark:border-white/10">
                      {Object.entries(collections.data.totalsByCurrency).map(([ccy, total]) => (
                        <span key={ccy} className="text-concrete-500">
                          {CCY_AR[ccy] ?? ccy}: <Money value={total} currency={ccy} />
                        </span>
                      ))}
                    </div>
                  )}
                  <Table>
                    <THead cols={['التاريخ', 'المبلغ', 'العملة', 'الطريقة', 'الحالة', 'المحصل', 'المرجع', 'ملاحظات']} />
                    <tbody>
                      {collections.data.items.map(co => (
                        <TRow key={co.id}>
                          <TD>{fmtDateTime(co.collectedAt)}</TD>
                          <TD className="font-semibold"><Money value={co.amount} /></TD>
                          <TD>{CCY_AR[co.currencyCode] ?? co.currencyCode}</TD>
                          <TD>{co.method?.name ?? '—'}</TD>
                          <TD>
                            <Badge tone={collectionStatusBadge(co.status) as any}>
                              {COLLECTION_STATUS_AR[co.status] ?? co.status}
                            </Badge>
                          </TD>
                          <TD>{co.collector?.user?.fullName ?? '—'}</TD>
                          <TD className="font-mono text-xs"><span dir="ltr">{co.receiptNumber ?? co.referenceNumber ?? '—'}</span></TD>
                          <TD className="max-w-[200px] truncate text-xs">{co.notes ?? '—'}</TD>
                        </TRow>
                      ))}
                    </tbody>
                  </Table>
                  <Pagination page={collections.data.page} totalPages={collections.data.totalPages} onPage={setCoPage} />
                </>
              )}
            </DataState>
          </Card>
        </TabsPanel>

        {/* حجوزات تشغيلية فقط ولا تؤثر على الرصيد المالي. */}
        <TabsPanel value="reservations">
          <Card>
            {canReservationsCreate && (
              <div className="flex justify-end border-b border-concrete-100 px-4 py-2.5 dark:border-white/10">
                <Button onClick={() => setCreateResOpen(true)}>حجز جديد</Button>
              </div>
            )}
            <DataState
              isLoading={reservations.isLoading}
              isError={reservations.isError}
              error={reservations.error}
              onRetry={() => reservations.refetch()}
              isFetching={reservations.isFetching}
              isEmpty={!reservations.data?.length}
              emptyTitle="لا توجد حجوزات بضاعة"
              skeletonClassName="h-48"
            >
              <Table>
                <THead cols={['الصنف', 'الكمية', 'الوحدة', 'سعر الوحدة', 'الإجمالي', 'المصروف', 'المتبقي', 'الحالة', 'تاريخ الحجز', '']} />
                <tbody>
                  {(reservations.data ?? []).map(r => (
                    <TRow key={r.id}>
                      <TD>
                        <div className="font-medium">{r.itemName}</div>
                        {r.itemType && <p className="text-xs text-concrete-500">{r.itemType}</p>}
                      </TD>
                      <TD className="tnum">{r.quantity ?? '—'}</TD>
                      <TD>{r.unit ?? '—'}</TD>
                      <TD><Money value={r.unitPrice ?? 0} currency={r.currencyCode} /></TD>
                      <TD><Money value={r.totalAmount ?? 0} currency={r.currencyCode} /></TD>
                      <TD className="tnum">{r.issuedQty}</TD>
                      <TD className="tnum">{r.remainingQty ?? '—'}</TD>
                      <TD>
                        <Badge tone={reservationStatusBadge(r.status) as any}>
                          {{ open: 'مفتوح', partial: 'مصروف جزئيًا', completed: 'مكتمل', cancelled: 'ملغي' }[r.status] ?? r.status}
                        </Badge>
                      </TD>
                      <TD>{fmtDate(r.reservedAt)}</TD>
                      <TD>
                        {(canReservationsDeliver || canReservationsCancel) && r.status !== 'completed' && r.status !== 'cancelled' && (
                          <div className="flex gap-2">
                            {canReservationsDeliver && <Button variant="secondary" onClick={() => setIssueRes(r)}>صرف</Button>}
                            {canReservationsCancel && <Button variant="danger" onClick={() => cancelResMut.mutate(r.id)} loading={cancelResMut.isPending}>إلغاء الحجز</Button>}
                          </div>
                        )}
                      </TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            </DataState>
          </Card>
        </TabsPanel>
      </Tabs>

      {/* نوافذ حجوزات البضاعة. */}
      <Dialog
        open={createResOpen}
        onClose={() => setCreateResOpen(false)}
        title="حجز بضاعة جديد"
      >
        <div className="space-y-4">
          <Field label="الصنف *">
            <Input
              value={resForm.itemName}
              onChange={(e) => setResForm(f => ({ ...f, itemName: e.target.value }))}
              placeholder="مثال: حديد تسليح 12 ملم"
            />
          </Field>
          <Field label="نوع الصنف" hint="اختياري">
            <Input
              value={resForm.itemType}
              onChange={(e) => setResForm(f => ({ ...f, itemType: e.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الكمية *">
              <Input
                type="number" min="0" step="any"
                value={resForm.quantity}
                onChange={(e) => setResForm(f => ({ ...f, quantity: e.target.value }))}
              />
            </Field>
            <Field label="الوحدة *">
              <Select
                value={resForm.unitId}
                onChange={(e) => setResForm(f => ({ ...f, unitId: e.target.value }))}
              >
                <option value="">اختر الوحدة</option>
                {(reservationUnits.data ?? []).map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.nameAr}{unit.weightKg === null ? ' — بلا وزن' : ` — ${unit.weightKg} كجم`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="سعر الوحدة *">
              <Input
                type="number" min="0" step="any"
                value={resForm.unitPrice}
                onChange={(e) => setResForm(f => ({ ...f, unitPrice: e.target.value }))}
              />
            </Field>
            <Field label="العملة *">
              <Select
                value={resForm.currencyCode}
                onChange={(e) => setResForm(f => ({ ...f, currencyCode: e.target.value }))}
              >
                {Object.entries(CCY_AR).map(([code]) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="المخزن" hint="اختياري">
            <Input
              value={resForm.warehouse}
              onChange={(e) => setResForm(f => ({ ...f, warehouse: e.target.value }))}
            />
          </Field>
          <Field label="رقم المستند" hint="اختياري">
            <Input
              value={resForm.documentNumber}
              onChange={(e) => setResForm(f => ({ ...f, documentNumber: e.target.value }))}
            />
          </Field>
          <Field label="ملاحظات" hint="اختياري">
            <Textarea
              value={resForm.notes}
              onChange={(e) => setResForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
            />
          </Field>
          <Field label="تاريخ الانتهاء" hint="اختياري">
            <Input
              type="date"
              value={resForm.expiresAt}
              onChange={(e) => setResForm(f => ({ ...f, expiresAt: e.target.value }))}
            />
          </Field>
          {canCreditOverride && <Field label="سبب تجاوز سقف الائتمان" hint="يُستخدم فقط إذا كان الحجز يتجاوز السقف أو الحساب مقيّدًا">
            <Textarea value={resForm.overrideReason} onChange={(e) => setResForm(f => ({ ...f, overrideReason: e.target.value }))} rows={2} />
          </Field>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCreateResOpen(false)}>إلغاء</Button>
            <Button
              disabled={!resFormValid}
              loading={createResMut.isPending}
              onClick={() => createResMut.mutate({
                customerId: id,
                itemName: resForm.itemName,
                itemType: resForm.itemType || undefined,
                quantity: Number(resForm.quantity),
                unitId: resForm.unitId,
                unitPrice: Number(resForm.unitPrice),
                currencyCode: resForm.currencyCode,
                warehouse: resForm.warehouse || undefined,
                documentNumber: resForm.documentNumber || undefined,
                notes: resForm.notes || undefined,
                expiresAt: resForm.expiresAt || undefined,
                overrideReason: resForm.overrideReason.trim() || undefined,
              })}
            >
              إنشاء الحجز
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!issueRes}
        onClose={() => setIssueRes(null)}
        title="صرف البضاعة المحجوزة"
      >
        {issueRes && (
          <div className="space-y-4">
            <p className="text-sm text-concrete-600 dark:text-concrete-400">
              {issueRes.itemName} — المتبقي: <span className="tnum font-medium">{issueRes.remainingQty}</span> {issueRes.unit}
            </p>
            <Field label="الكمية المراد صرفها *">
              <Input
                type="number" min="0" step="any"
                value={issueQty}
                onChange={(e) => setIssueQty(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setIssueRes(null)}>إلغاء</Button>
              <Button
                disabled={!(Number(issueQty) > 0 && Number(issueQty) <= Number(issueRes.remainingQty ?? 0))}
                loading={issueResMut.isPending}
                onClick={() => issueResMut.mutate({ resId: issueRes.id, qty: Number(issueQty) })}
              >
                صرف
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

/* ──────────────────────────── Small Helpers ────────────────────────────── */

const RISK_LEVEL_TONE: Record<string, 'neutral' | 'pine' | 'hazard' | 'debt' | 'credit'> = {
  low: 'pine', medium: 'credit', high: 'hazard', critical: 'debt',
};
const RISK_LEVEL_AR: Record<string, string> = {
  low: 'منخفضة', medium: 'متوسطة', high: 'مرتفعة', critical: 'حرجة',
};

function RiskCard({ data, isLoading, isError, error, onRetry }: {
  data: RiskResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const notComputed = isError && error instanceof ApiError && error.status === 404;
  const factors = Object.values(data?.reasons?.factors ?? {}).sort((a, b) => b.points - a.points);
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-iron-900 dark:text-concrete-100">درجة المخاطر</h3>
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : notComputed || !data ? (
        <Empty
          title="لا توجد درجة مخاطر محسوبة"
          hint="نفّذ إعادة احتساب درجات المخاطر أولاً من شاشة إعدادات النظام"
        />
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="tnum text-3xl font-bold text-iron-900 dark:text-concrete-100">{data.score}</span>
            <Badge tone={RISK_LEVEL_TONE[data.riskLevel] ?? 'neutral'}>
              {RISK_LEVEL_AR[data.riskLevel] ?? data.riskLevel}
            </Badge>
            <span className="text-xs text-concrete-400">آخر احتساب: {fmtDateTime(data.computedAt)}</span>
          </div>
          {factors.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {factors.map((f, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="tnum w-8 shrink-0 rounded bg-concrete-100 px-1 text-center text-xs font-bold text-concrete-600 dark:bg-white/10 dark:text-concrete-300">
                    {f.points}
                  </span>
                  <span className="w-36 shrink-0 text-xs text-concrete-500">{f.label}</span>
                  <span className="text-concrete-700 dark:text-concrete-200">{f.text}</span>
                </li>
              ))}
            </ul>
          )}
          {isError && !notComputed && (
            <div className="mt-3 space-y-2">
              <ErrorNote message={friendlyApiError(error)} />
              <Button variant="secondary" onClick={onRetry}>إعادة المحاولة</Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function TasksCard({ data, isLoading, isError, error, onRetry, onComplete, completeBusyId }: {
  data: CustomerTaskItem[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onComplete: (task: CustomerTaskItem) => void;
  completeBusyId: string | null;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-concrete-100 px-4 py-3 dark:border-white/10">
        <h3 className="text-sm font-semibold text-iron-900 dark:text-concrete-100">المهام المفتوحة</h3>
        {data && data.length > 0 && <Badge tone="hazard">{data.length} مهمة</Badge>}
      </div>
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : isError ? (
        <div className="space-y-2 p-4">
          <ErrorNote message={friendlyApiError(error)} />
          <Button variant="secondary" onClick={onRetry}>إعادة المحاولة</Button>
        </div>
      ) : !data?.length ? (
        <Empty
          title="لا توجد مهام مفتوحة لهذا العميل"
          hint="تظهر المهام هنا بعد توليد قائمة عمل اليوم"
        />
      ) : (
        <Table>
          <thead>
            <tr className="border-b border-concrete-100 text-right text-xs text-concrete-500 dark:border-white/10">
              <th className="px-4 py-2.5 font-medium">النوع</th>
              <th className="px-4 py-2.5 font-medium">السبب</th>
              <th className="px-4 py-2.5 font-medium">المبلغ المتوقع</th>
              <th className="px-4 py-2.5 font-medium">الإسناد</th>
              <th className="px-4 py-2.5 font-medium">الاستحقاق</th>
              <th className="px-4 py-2.5 font-medium">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {data.map(t => (
              <TRow key={t.id}>
                <TD className="text-xs">
                  <Badge tone="neutral">{TASK_TYPE_AR[t.taskType] ?? t.taskType}</Badge>
                </TD>
                <TD className="text-xs text-concrete-600 dark:text-concrete-400">{t.priorityReason}</TD>
                <TD>
                  {t.expectedAmount != null && t.expectedCurrency ? (
                    <Money value={t.expectedAmount} currency={t.expectedCurrency} />
                  ) : (
                    <span className="text-concrete-400">—</span>
                  )}
                </TD>
                <TD className="text-xs">
                  {t.assignedToName ? (
                    <span className="flex items-center gap-1 text-pine-700 dark:text-pine-100">
                      <UserCheck className="h-3.5 w-3.5" /> {t.assignedToName}
                    </span>
                  ) : (
                    <Badge tone="hazard">غير مسند</Badge>
                  )}
                </TD>
                <TD className="text-xs">{fmtDate(t.dueDate)}</TD>
                <TD>
                  <Button
                    variant="success"
                    className="text-xs px-2 py-1"
                    onClick={() => onComplete(t)}
                    loading={completeBusyId === t.id}
                    disabled={completeBusyId != null && completeBusyId !== t.id}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> إكمال
                  </Button>
                </TD>
              </TRow>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

/* ─── نتائج إكمال المهمة المعتمدة (PR 9) — تطابق واجهة POST /tasks/:id/complete ─── */
const TASK_COMPLETE_RESULTS: { value: string; label: string }[] = [
  { value: 'contacted', label: 'تواصل ناجح' },
  { value: 'no_answer', label: 'لا يرد' },
  { value: 'promise', label: 'وعد بالسداد' },
  { value: 'needs_visit', label: 'يحتاج زيارة' },
  { value: 'deferred', label: 'مؤجل' },
  { value: 'note', label: 'ملاحظة' },
];

function TaskCompletePanel({ task, busy, error, onCancel, onSubmit }: {
  task: CustomerTaskItem;
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [result, setResult] = useState('contacted');
  const [notes, setNotes] = useState('');
  const [nextFollowupDate, setNextFollowupDate] = useState('');
  const [promiseDueDate, setPromiseDueDate] = useState('');
  const [promiseAmount, setPromiseAmount] = useState(
    task.expectedAmount != null ? String(task.expectedAmount) : '',
  );
  const [promiseCurrency, setPromiseCurrency] = useState(task.expectedCurrency ?? 'YER');
  const [clientError, setClientError] = useState<string | null>(null);

  const isPromise = result === 'promise';

  const submit = () => {
    if (isPromise && !promiseDueDate) {
      setClientError('حدد تاريخ استحقاق الوعد أولاً');
      return;
    }
    setClientError(null);
    const body: Record<string, unknown> = { result, notes: notes.trim() || undefined };
    if (nextFollowupDate) body.nextFollowupDate = nextFollowupDate;
    if (isPromise) {
      body.promiseDueDate = promiseDueDate;
      if (promiseAmount.trim()) body.promiseAmount = Number(promiseAmount);
      body.promiseCurrency = promiseCurrency;
    }
    onSubmit(body);
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-iron-900 dark:text-concrete-100">
          إكمال مهمة — {TASK_TYPE_AR[task.taskType] ?? task.taskType}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-xs text-concrete-500 hover:text-concrete-700 dark:hover:text-concrete-300"
        >
          إغلاق
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="النتيجة">
          <Select value={result} onChange={e => setResult(e.target.value)}>
            {TASK_COMPLETE_RESULTS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="موعد المتابعة القادمة">
          <Input type="date" value={nextFollowupDate} onChange={e => setNextFollowupDate(e.target.value)} />
        </Field>
        {isPromise && (
          <>
            <Field label="تاريخ استحقاق الوعد (مطلوب)">
              <Input type="date" value={promiseDueDate} onChange={e => setPromiseDueDate(e.target.value)} />
            </Field>
            <Field label="مبلغ الوعد" hint={task.expectedAmount != null ? `المتوقع في المهمة: ${task.expectedAmount}` : undefined}>
              <Input
                type="number" min="0" step="0.01" dir="ltr"
                value={promiseAmount} onChange={e => setPromiseAmount(e.target.value)}
              />
            </Field>
            <Field label="العملة">
              <Select value={promiseCurrency} onChange={e => setPromiseCurrency(e.target.value)}>
                {Object.entries(CCY_AR).map(([code, name]) => (
                  <option key={code} value={code}>{name} ({code})</option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <div className="sm:col-span-2">
          <Field label="ملاحظات">
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </Field>
        </div>
      </div>
      {clientError || error ? (
        <ErrorNote message={clientError ?? friendlyApiError(error)} />
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <Button variant="success" onClick={submit} loading={busy} disabled={busy}>
          <CheckCircle2 className="h-4 w-4" /> إتمام المهمة
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>إلغاء</Button>
      </div>
    </Card>
  );
}

function AssignmentCard({ data, isLoading, isError, error, onRetry, canManage, selCollector, onSelectCollector, assignBusy, unassignBusy, assignError, unassignError, onAssign, onUnassign }: {
  data: AssignmentResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  canManage: boolean;
  selCollector: string;
  onSelectCollector: (v: string) => void;
  assignBusy: boolean;
  unassignBusy: boolean;
  assignError: unknown;
  unassignError: unknown;
  onAssign: () => void;
  onUnassign: () => void;
}) {
  const current = data?.assignment ?? null;
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-concrete-100 px-4 py-3 dark:border-white/10">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-iron-900 dark:text-concrete-100">
          <UserCheck className="h-4 w-4 text-pine-700 dark:text-pine-100" /> الإسناد للمحصل
        </h3>
      </div>
      {isLoading ? (
        <Skeleton className="m-4 h-20" />
      ) : isError ? (
        <div className="space-y-2 p-4">
          <ErrorNote message={friendlyApiError(error)} />
          <Button variant="secondary" onClick={onRetry}>إعادة المحاولة</Button>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          {current ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="pine">{current.collectorName}</Badge>
              <span className="text-concrete-500">منذ {fmtDate(current.since)}</span>
              {current.reason && (
                <span className="text-xs text-concrete-400">({current.reason})</span>
              )}
            </div>
          ) : data!.collectors.length === 0 ? (
            <p className="text-sm text-concrete-600 dark:text-concrete-400">
              العميل غير مسند لأي محصل — لا يوجد محصلون نشطون في المنظمة حالياً.
            </p>
          ) : (
            <p className="text-sm text-concrete-600 dark:text-concrete-400">
              العميل غير مسند لأي محصل حالياً.
            </p>
          )}

          {canManage && data!.collectors.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={selCollector}
                onChange={e => onSelectCollector(e.target.value)}
                className="min-w-[220px]"
              >
                <option value="">اختر محصلاً...</option>
                {data!.collectors.map(co => (
                  <option key={co.id} value={co.id}>{co.name}</option>
                ))}
              </Select>
              <Button
                onClick={onAssign}
                disabled={!selCollector || assignBusy}
                title={!selCollector ? 'اختر محصلاً أولاً' : undefined}
              >
                {assignBusy ? 'جارٍ الإسناد...' : 'إسناد'}
              </Button>
              {current && (
                <Button variant="secondary" onClick={onUnassign} disabled={unassignBusy}>
                  <UserX className="h-4 w-4" /> {unassignBusy ? 'جارٍ فك الإسناد...' : 'فك الإسناد'}
                </Button>
              )}
            </div>
          )}

          {assignError ? (
            <ErrorNote message={friendlyApiError(assignError)} />
          ) : null}
          {unassignError ? (
            <ErrorNote message={friendlyApiError(unassignError)} />
          ) : null}
        </div>
      )}
    </Card>
  );
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-concrete-100 bg-white p-4 dark:border-white/10 dark:bg-iron-900">
      <p className="text-xs text-concrete-500">{label}</p>
      <div className="mt-1 text-sm font-semibold text-iron-900 dark:text-concrete-100">{value}</div>
    </div>
  );
}

function DetailRow({ label, value, dir }: { label: string; value?: string | null; dir?: 'ltr' | 'rtl' }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-concrete-500">{label}</dt>
      <dd className="font-medium text-iron-800 dark:text-concrete-100" dir={dir}>{value}</dd>
    </div>
  );
}

function CountBadge({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-lg border border-concrete-100 p-3 text-center dark:border-white/10">
      <p className="text-lg font-bold text-iron-900 dark:text-concrete-100">{count}</p>
      <p className="text-[10px] text-concrete-500">{label}</p>
    </div>
  );
}
