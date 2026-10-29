'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Plus, RefreshCw, Search, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { CCY_AR } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { Badge, Button, Card, Field, Input, Money, Pagination, Select } from '@/components/ui/primitives';
import { Table, TD, THead, TRow } from '@/components/ui/table';
import { CustomerFormDialog } from '@/components/customer-form-dialog';

interface AdvanceAccount {
  id: string;
  externalCustomerCode: string;
  accountNumber: string | null;
  name: string;
  customerType: string | null;
  balances: { currency: string; balance: number }[];
  status: string;
}

interface AccountsResponse {
  page: number;
  total: number;
  totalPages: number;
  items: AdvanceAccount[];
}

interface AdvanceSummary {
  accounts: number;
  byCurrency: Record<string, AdvanceCurrencySummary>;
}

interface AdvanceCurrencySummary {
  accounts: number;
  debtorAccounts: number;
  debtorBalance: number;
  creditorAccounts: number;
  creditorBalance: number;
  netBalance: number;
}

interface ImportPreview {
  profile: string;
  rowsRead: number;
  accountsInFile: number;
  uniqueAccounts: number;
  movementsInFile: number;
  mainAccountsIgnored: string[];
  byCurrency: Record<string, { accounts: number; movements: number; balance: number }>;
  errors: { rowNumber: number; message: string }[];
  warnings: { rowNumber: number; message: string }[];
  sampleAccounts: { accountNumber: string; accountName: string; currencyCode: string; computedBalance: number }[];
}

interface ImportResult {
  status: 'dry_run' | 'completed';
  preview: ImportPreview;
  importJobId?: string;
  accountsCreated?: number;
  accountsUpdated?: number;
  movementsInserted?: number;
  movementsSkippedDuplicate?: number;
}

interface OracleSyncPreview {
  profile: 'ORACLE_ADVANCES_LIVE' | 'ORACLE_ADVANCES_LEDGER';
  sourceSchema: 'IAS20261';
  sourceAccountCodes: readonly string[];
  sourceAccounts: number;
  balanceRows: number;
  byCurrency: Record<string, AdvanceCurrencySummary>;
  sampleAccounts: { sourceAccountCode: string; accountNumber: string; nameAr: string }[];
  readMode: 'SELECT_ONLY';
  oracleWrite: 'NONE';
}

interface OracleSyncResult {
  status: 'dry_run' | 'completed' | 'partial';
  preview: OracleSyncPreview;
  importJobId?: string;
  accountsCreated?: number;
  accountsUpdated?: number;
  balancesUpdated?: number;
  balancesCleared?: number;
  tasksCreated?: number;
  transactionsImported?: number;
  unchanged?: number;
  issues?: { accountNumber: string; currency?: string; reason: string }[];
}

export default function AdvancesPage() {
  const can = useCan();
  const canRead = can('customers.read');
  const canManage = can('customers.write');
  const qc = useQueryClient();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [currency, setCurrency] = useState('');
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [syncPreview, setSyncPreview] = useState<OracleSyncPreview | null>(null);
  const [syncIssues, setSyncIssues] = useState<NonNullable<OracleSyncResult['issues']>>([]);

  const accounts = useQuery<AccountsResponse>({
    queryKey: ['advances', search, currency, page],
    queryFn: () => {
      const params = new URLSearchParams({ accountClass: 'advance', page: String(page), limit: '25', sortBy: 'code', sortDir: 'asc' });
      if (search) params.set('search', search);
      if (currency) params.set('currency', currency);
      return api<AccountsResponse>(`/customers?${params.toString()}`);
    },
    enabled: canRead,
  });
  const summary = useQuery<AdvanceSummary>({
    queryKey: ['advances-summary'],
    queryFn: () => api<AdvanceSummary>('/customers/advances/summary'),
    enabled: canRead,
  });

  const runImport = async (dryRun: boolean) => {
    const body = new FormData();
    body.append('file', file as File);
    return api<ImportResult>(
      `/analytical-accounts/import-advances?dryRun=${dryRun}`,
      { method: 'POST', body },
    );
  };
  const previewImport = useMutation({
    mutationFn: () => runImport(true),
    onSuccess: (result) => {
      setPreview(result.preview);
      if (result.preview.errors.length) toast('اكتمل الفحص مع أخطاء تمنع الاستيراد', 'err');
      else toast('نجح الفحص التجريبي — لم تُحفظ أي بيانات بعد', 'ok');
    },
    onError: (error: Error) => toast(error.message, 'err'),
  });
  const executeImport = useMutation({
    mutationFn: () => runImport(false),
    onSuccess: (result) => {
      toast(`تم استيراد ${result.movementsInserted ?? 0} حركة سلف بنجاح`, 'ok');
      setImportOpen(false);
      setFile(null);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ['advances'] });
      qc.invalidateQueries({ queryKey: ['advances-summary'] });
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: (error: Error) => toast(error.message, 'err'),
  });
  const previewOracleSync = useMutation({
    mutationFn: () => api<OracleSyncResult>('/analytical-accounts/sync-advances?dryRun=true', { method: 'POST' }),
    onSuccess: (result) => {
      setSyncPreview(result.preview);
      setSyncIssues(result.issues ?? []);
      setSyncOpen(true);
      toast(result.issues?.length ? `اكتمل الفحص؛ ${result.issues.length} حساب/عملة يحتاج مراجعة ولن يتم تغييره` : 'نجح فحص أرصدة السلف وحركاتها — لم تُحفظ بيانات بعد', result.issues?.length ? 'err' : 'ok');
    },
    onError: (error: Error) => toast(error.message, 'err'),
  });
  const executeOracleSync = useMutation({
    mutationFn: () => api<OracleSyncResult>('/analytical-accounts/sync-advances?dryRun=false', { method: 'POST' }),
    onSuccess: (result) => {
      setSyncIssues(result.issues ?? []);
      toast(`تم تحديث ${result.balancesUpdated ?? 0} رصيد و${result.transactionsImported ?? 0} حركة؛ ${result.unchanged ?? 0} دون تغيير${result.issues?.length ? `، و${result.issues.length} بحاجة للمراجعة` : ''}`, result.issues?.length ? 'err' : 'ok');
      setSyncOpen(false);
      setSyncPreview(null);
      qc.invalidateQueries({ queryKey: ['advances'] });
      qc.invalidateQueries({ queryKey: ['advances-summary'] });
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error: Error) => toast(error.message, 'err'),
  });

  if (!canRead) return <Card><PermissionNotice message="لا تملك صلاحية عرض حسابات السلف" /></Card>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="السلف"
        action={canManage ? <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />إضافة حساب سلفة</Button><Button variant="secondary" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> استيراد كشف</Button><Button loading={previewOracleSync.isPending} onClick={() => previewOracleSync.mutate()}><RefreshCw className="h-4 w-4" /> مزامنة أوراكل</Button></div> : undefined}
      />

      {syncIssues.length > 0 && <Card>
        <p className="font-semibold text-amber-700">حسابات لم تُحدّث حفاظًا على صحة الرصيد</p>
        <p className="text-sm">تحتاج مطابقة كشف Oracle ورصيده أو مراجعة القيود المستوردة يدويًا. بقيت بياناتها السابقة محفوظة.</p>
        <ul className="mt-2 text-sm">{syncIssues.map((issue, index) => <li key={`${issue.accountNumber}-${issue.currency}-${index}`}>ADV-{issue.accountNumber} {issue.currency ? `— ${CCY_AR[issue.currency] ?? issue.currency}` : ''}</li>)}</ul>
      </Card>}
      <DataState
        isLoading={summary.isLoading}
        isError={summary.isError}
        error={summary.error}
        onRetry={() => summary.refetch()}
        isFetching={summary.isFetching}
        isEmpty={false}
        emptyTitle=""
        skeletonClassName="h-28"
      >
        {summary.data && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="p-4">
              <div className="flex items-center gap-2"><Banknote className="h-5 w-5 text-pine-700" /><p className="text-xs text-concrete-500">حسابات السلف</p></div>
              <p className="tnum mt-2 font-display text-2xl font-bold">{summary.data.accounts}</p>
            </Card>
            {Object.entries(summary.data.byCurrency).map(([code, value]) => (
              <Card key={code} className="p-4">
                <div className="flex items-center justify-between"><p className="text-xs text-concrete-500">السلف — {CCY_AR[code] ?? code}</p><Badge tone="pine">{code}</Badge></div>
                <AdvanceBalanceSides code={code} value={value} />
              </Card>
            ))}
          </div>
        )}
      </DataState>

      <Card>
        <div className="flex flex-wrap gap-3 border-b border-concrete-100 p-4 dark:border-white/10">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-concrete-400" />
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="بحث برقم حساب السلفة أو اسم صاحب الحساب" className="pr-10" />
          </div>
          <Select value={currency} onChange={(event) => { setCurrency(event.target.value); setPage(1); }} className="w-44">
            <option value="">كل العملات</option>
            {Object.entries(CCY_AR).map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
          </Select>
        </div>
        <DataState
          isLoading={accounts.isLoading}
          isError={accounts.isError}
          error={accounts.error}
          onRetry={() => accounts.refetch()}
          isFetching={accounts.isFetching}
          isEmpty={!accounts.data?.items.length}
          emptyTitle="لا توجد حسابات سلف مستوردة"
          skeletonClassName="h-64"
        >
          {accounts.data && <>
            <Table>
              <THead cols={['رقم حساب السلفة', 'صاحب الحساب', 'الأرصدة', 'الحالة', 'الإجراءات']} />
              <tbody>{accounts.data.items.map((account) => (
                <TRow key={account.id}>
                  <TD><Link className="font-semibold text-pine-700 hover:underline dark:text-pine-200" href={`/customers/${account.id}`}>{account.accountNumber ?? account.externalCustomerCode}</Link></TD>
                  <TD>{account.name}</TD>
                  <TD><div className="flex flex-wrap gap-2">{account.balances.map((balance) => <span key={balance.currency} className="inline-flex items-center gap-1"><Money value={balance.balance} currency={balance.currency} signed /><Badge tone="neutral">{balance.currency}</Badge></span>)}</div></TD>
                  <TD><Badge tone={account.status === 'active' ? 'pine' : 'neutral'}>{account.status === 'active' ? 'نشط' : 'غير نشط'}</Badge></TD>
                  <TD><Link className="font-semibold text-pine-700 hover:underline dark:text-pine-200" href={`/customers/${account.id}`}>فتح الحساب والمتابعة</Link></TD>
                </TRow>
              ))}</tbody>
            </Table>
            <Pagination page={accounts.data.page} totalPages={accounts.data.totalPages} onPage={setPage} />
          </>}
        </DataState>
      </Card>

      <CustomerFormDialog open={createOpen} onClose={() => setCreateOpen(false)} defaultCustomerType="advance" onSaved={(saved) => router.push(`/customers/${saved.id}`)} />

      <Dialog open={importOpen} onClose={() => { setImportOpen(false); setPreview(null); }} title="استيراد كشف السلف على الغير">
        <div className="space-y-4">
          <p className="rounded-lg bg-pine-50 p-3 text-sm text-pine-800 dark:bg-pine-900/20 dark:text-pine-100">
            سيُعتمد رقم الحساب التحليلي فقط. أرقام الحسابات الرئيسية الموجودة في الملف ستُقرأ للتدقيق ثم تُتجاهل تمامًا.
          </p>
          <Field label="ملف Excel" hint="الصيغة المدعومة: xlsx">
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} className="block w-full text-sm" />
          </Field>
          {!preview && <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setImportOpen(false)}>إلغاء</Button><Button disabled={!file} loading={previewImport.isPending} onClick={() => previewImport.mutate()}>فحص تجريبي</Button></div>}
          {preview && <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <PreviewStat label="الحسابات" value={preview.accountsInFile} />
              <PreviewStat label="حسابات السلف" value={preview.uniqueAccounts} />
              <PreviewStat label="الحركات" value={preview.movementsInFile} />
              <PreviewStat label="الأخطاء" value={preview.errors.length} danger={preview.errors.length > 0} />
            </div>
            <div className="rounded-lg border border-concrete-100 p-3 text-sm dark:border-white/10">
              <p className="font-semibold">الحسابات الرئيسية التي لن تُعتمد</p>
              <p className="mt-1 font-mono" dir="ltr">{preview.mainAccountsIgnored.join('، ') || 'لا يوجد'}</p>
            </div>
            {Object.entries(preview.byCurrency).map(([code, value]) => <div key={code} className="flex items-center justify-between rounded-lg bg-concrete-50 px-3 py-2 text-sm dark:bg-white/5"><span>{CCY_AR[code] ?? code} — {value.accounts} حساب</span><Money value={value.balance} currency={code} signed /></div>)}
            {preview.errors.length > 0 && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{preview.errors.slice(0, 8).map((error) => <p key={`${error.rowNumber}-${error.message}`}>الصف {error.rowNumber || '—'}: {error.message}</p>)}</div>}
            {preview.warnings.length > 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{preview.warnings.slice(0, 8).map((warning) => <p key={`${warning.rowNumber}-${warning.message}`}>الصف {warning.rowNumber}: {warning.message}</p>)}</div>}
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => { setPreview(null); setFile(null); }}>اختيار ملف آخر</Button><Button disabled={preview.errors.length > 0} loading={executeImport.isPending} onClick={() => executeImport.mutate()}>اعتماد الاستيراد</Button></div>
          </div>}
        </div>
      </Dialog>

      <Dialog open={syncOpen} onClose={() => { setSyncOpen(false); setSyncPreview(null); }} title="مزامنة حسابات السلف من أوراكل">
        {syncPreview && <div className="space-y-4">
          <p className="rounded-lg bg-pine-50 p-3 text-sm text-pine-800 dark:bg-pine-900/20 dark:text-pine-100">
            تم الفحص من {syncPreview.sourceSchema} بوضع قراءة فقط. ستُحدّث الأسماء والأرصدة داخل المنصة، ولن تُكتب أي بيانات في أوراكل ولن تُحذف حسابات المنصة.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <PreviewStat label="الحسابات" value={syncPreview.sourceAccounts} />
            <PreviewStat label="صفوف الأرصدة" value={syncPreview.balanceRows} />
            <PreviewStat label="الحسابات الرئيسية" value={syncPreview.sourceAccountCodes.length} />
            <PreviewStat label="أخطاء الفحص" value={0} />
          </div>
          <div className="rounded-lg border border-concrete-100 p-3 text-sm dark:border-white/10">
            <p className="font-semibold">نطاق المزامنة</p>
            <p className="mt-1 font-mono" dir="ltr">{syncPreview.sourceAccountCodes.join(' + ')}</p>
          </div>
          {Object.entries(syncPreview.byCurrency).map(([code, value]) => <div key={code} className="rounded-lg bg-concrete-50 px-3 py-2 text-sm dark:bg-white/5"><div className="flex items-center justify-between"><span>{CCY_AR[code] ?? code}</span><Badge tone="neutral">{value.accounts} حساب/عملة</Badge></div><AdvanceBalanceSides code={code} value={value} compact /></div>)}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => { setSyncOpen(false); setSyncPreview(null); }}>إلغاء</Button><Button loading={executeOracleSync.isPending} onClick={() => executeOracleSync.mutate()}>اعتماد المزامنة</Button></div>
        </div>}
      </Dialog>
    </div>
  );
}

function PreviewStat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return <div className="rounded-lg border border-concrete-100 p-3 text-center dark:border-white/10"><p className="text-xs text-concrete-500">{label}</p><p className={`tnum mt-1 text-lg font-bold ${danger ? 'text-red-600' : ''}`}>{value}</p></div>;
}

function AdvanceBalanceSides({ code, value, compact = false }: { code: string; value: AdvanceCurrencySummary; compact?: boolean }) {
  return <div className={`${compact ? 'mt-2' : 'mt-3'} grid grid-cols-2 gap-2`}>
    <div className="rounded-lg bg-red-50 p-2 dark:bg-red-950/20">
      <p className="text-[11px] font-semibold text-red-700 dark:text-red-300">مدين · {value.debtorAccounts}</p>
      <p className="mt-1 font-bold text-red-700 dark:text-red-200"><Money value={value.debtorBalance} currency={code} /></p>
    </div>
    <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/20">
      <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">دائن · {value.creditorAccounts}</p>
      <p className="mt-1 font-bold text-emerald-700 dark:text-emerald-200"><Money value={value.creditorBalance} currency={code} /></p>
    </div>
  </div>;
}
