'use client';
import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  Play,
  History,
  Clock,
} from 'lucide-react';
import { API, api, tokenStore } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDateTime, IMPORT_STATUS_AR } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { Badge, Button, Card, Skeleton } from '@/components/ui/primitives';
import { Table, TRow, TD } from '@/components/ui/table';

/* ────────────────────────────── Types ────────────────────────────────── */

interface ImportRow {
  id: string;
  fileName: string;
  status: 'dry_run' | 'running' | 'completed' | 'failed';
  importedAt: string | null;
  txnsInFile: number | null;
  txnsInserted: number | null;
  txnsSkippedDuplicate: number | null;
  customersNew: number | null;
  customersUpdated: number | null;
  errorsCount: number;
  profile?: string;
  executable?: boolean;
  uploader: { id: string; fullName: string };
}

interface PreviouslyImported {
  jobId: string;
  importedAt: string;
}

interface UploadResponse {
  jobId: string;
  status: 'dry_run';
  previouslyImported: PreviouslyImported | null;
  preview: Preview;
  nextStep: string;
}

interface Preview {
  profile: string;
  format: 'xlsx' | 'tsv';
  executable: boolean;
  deferredReason: string | null;
  accountsInFile: number;
  customersInFile: number;
  transactionsInFile: number;
  fragmentedAccountsMerged: number;
  importableAccounts: number;
  importableTransactions: number;
  importableCustomers?: number;
  importableBalances?: number;
  balancesInFile?: number;
  agingRowsInFile?: number;
  currenciesInFile?: string[];
  parserErrors: number;
  ruleErrors: number;
  parserErrorDetails: ParserRuleError[];
  ruleErrorDetails: ParserRuleError[];
  sampleAccounts: SampleAccount[];
  sampleCustomers: SampleCustomer[];
  sampleBalances: SampleBalance[];
  sampleAgingRows: SampleAgingRow[];
}

interface ParserRuleError {
  rowNumber: number | null;
  message: string;
}

interface SampleAccount {
  customerCode: string;
  customerName: string;
  currency: string;
  transactions: SampleTxn[];
}

interface SampleTxn {
  rowNumber: number;
  date: string;
  description: string;
  debit: number | null;
  credit: number | null;
}

interface SampleCustomer {
  rowNumber: number;
  customerCode: string;
  customerName: string;
  phone: string | null;
  region: string | null;
  customerType: string | null;
}

interface SampleBalance {
  rowNumber: number;
  customerCode: string;
  customerName: string;
  currency: string;
  balance: number;
}

interface SampleAgingRow {
  rowNumber: number;
  customerCode?: string;
  customerName?: string;
  currency: string;
  buckets: Record<string, number>;
  total: number | null;
}

interface ReportData {
  jobId: string;
  fileName: string;
  status: string;
  profile?: string;
  importedAt: string;
  rowsRead: number;
  rowsImported: number;
  rowsIgnored: number;
  errorsCount: number;
  customersNew: number;
  customersUpdated: number;
  transactionsNew: number;
  transactionsDuplicate: number;
  durationMs: number;
  balancesBefore: Record<string, number>;
  balancesAfter: Record<string, number>;
  balancesWritten?: number | null;
  duplicateNamePairsFlagged: number;
  reconciliationsOpened: number;
}

interface ErrorDetail {
  jobId: string;
  profile?: string;
  executable?: boolean;
  deferredReason?: string | null;
  parserErrors: ParserRuleError[];
  ruleErrors: ParserRuleError[];
  executeErrors: string[];
  accountWarnings: string[];
  fatal: string | null;
}

/* ────────────────────────────── Constants ────────────────────────────── */

const ALLOWED_EXT = ['.xlsx', '.xlsm', '.xls'];
const MAX_SIZE_MB = 30;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

const PROFILE_AR: Record<string, string> = {
  CUSTOMER_STATEMENT_DETAILS: 'كشف الحساب',
  CUSTOMER_MASTER: 'بيانات العملاء',
  CUSTOMER_BALANCE_SUMMARY: 'ملخص الأرصدة',
  DEBT_AGING_SUMMARY: 'تقسيم الأعمار (مجمّع)',
  DEBT_AGING_DETAILS: 'تقسيم الأعمار (تفصيلي)',
};

const STATUS_BADGE: Record<ImportRow['status'], 'pine' | 'hazard' | 'neutral' | 'debt'> = {
  completed: 'pine',
  dry_run: 'hazard',
  running: 'neutral',
  failed: 'debt',
};

/* ────────────────────────────── Helpers ──────────────────────────────── */

function fileError(msg: string): never {
  throw new Error(msg);
}

function validateFile(file: File) {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    fileError('الملف يجب أن يكون بصيغة .xlsx أو .xlsm أو .xls (نصي مفصول بـ Tab)');
  }
  if (file.size > MAX_SIZE_BYTES) {
    fileError(`حجم الملف يتجاوز ${MAX_SIZE_MB} ميجابايت`);
  }
}

async function uploadFile(file: File): Promise<UploadResponse> {
  validateFile(file);
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API}/imports/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenStore.access}` },
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = Array.isArray(body?.message)
      ? body.message.join('، ')
      : body?.message ?? 'فشل رفع الملف';
    throw new Error(msg);
  }
  return res.json();
}

function fmtNumber(n: number | null | undefined) {
  return n == null ? '—' : n.toLocaleString('en-US');
}

/* ────────────────────────────── Main Page ────────────────────────────── */

export default function ImportsPage() {
  const can = useCan();
  const canRead = can('imports.read');
  const canRun = can('imports.run');
  const qc = useQueryClient();

  /* ──── Dialog State ──── */
  const [previewData, setPreviewData] = useState<UploadResponse | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorImportId, setErrorImportId] = useState<string | null>(null);

  /* ──── Queries ──── */
  const listQuery = useQuery<ImportRow[]>({
    queryKey: ['imports'],
    queryFn: () => api<ImportRow[]>('/imports'),
    enabled: canRead,
  });

  const reportQuery = useQuery<ReportData>({
    queryKey: ['imports', 'report', reportJobId],
    queryFn: () => api<ReportData>(`/imports/${reportJobId}/report`),
    enabled: reportOpen && !!reportJobId,
  });

  const errorQuery = useQuery<ErrorDetail>({
    queryKey: ['imports', 'errors', errorImportId],
    queryFn: () => api<ErrorDetail>(`/imports/${errorImportId}/errors`),
    enabled: errorOpen && !!errorImportId,
  });

  /* ──── Helpers to open dialogs ──── */
  const openReport = (jobId: string) => {
    setReportJobId(jobId);
    setReportOpen(true);
  };

  const closeReport = () => {
    setReportOpen(false);
    setReportJobId(null);
  };

  const openErrors = (importId: string) => {
    setErrorImportId(importId);
    setErrorOpen(true);
  };

  const closeErrors = () => {
    setErrorOpen(false);
    setErrorImportId(null);
  };

  /* ──── Upload Mutation ──── */
  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadFile(file),
    onSuccess: (data) => {
      setPreviewData(data);
      qc.invalidateQueries({ queryKey: ['imports'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  /* ──── Execute Mutation ──── */
  const executeMut = useMutation({
    mutationFn: (jobId: string) =>
      api<ReportData>(`/imports/${jobId}/execute`, {
        method: 'POST',
        body: JSON.stringify({ force: false }),
      }),
    onSuccess: (data) => {
      toast('تم تنفيذ الاستيراد بنجاح', 'ok');
      setPreviewData(null);
      openReport(data.jobId);
      qc.invalidateQueries({ queryKey: ['imports'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  /* ──── Permission Gate ──── */
  if (!canRead) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية عرض الاستيرادات (imports.read)" />
      </Card>
    );
  }

  const items = listQuery.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="استيراد Excel"
        action={
          canRun ? (
            <Button onClick={() => document.getElementById('file-upload-input')?.click()}>
              <Upload className="h-4 w-4" aria-hidden />
              رفع ملف جديد
            </Button>
          ) : null
        }
      />

      {/* ──── Upload Zone ──── */}
      {canRun && (
        <Card className="overflow-hidden">
          <UploadZone
            onFile={(file) => uploadMut.mutate(file)}
            uploading={uploadMut.isPending}
          />
        </Card>
      )}

      {/* ──── History Table ──── */}
      <Card>
        <div className="border-b border-concrete-100 px-4 py-3 dark:border-white/10">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4 text-concrete-400" aria-hidden />
            سجل الاستيرادات
          </div>
        </div>
        <DataState
          isLoading={listQuery.isLoading}
          isError={listQuery.isError}
          error={listQuery.error}
          onRetry={() => listQuery.refetch()}
          isFetching={listQuery.isFetching}
          isEmpty={!items.length}
          emptyTitle="لا توجد استيرادات"
          emptyHint="ارفع ملف Excel لبدء أول استيراد"
          skeletonClassName="h-64"
        >
          <Table>
            <thead>
              <tr className="border-b border-concrete-100 text-right text-xs text-concrete-500 dark:border-white/10 dark:text-concrete-400">
                <th className="px-4 py-2.5 font-medium">الملف</th>
                <th className="px-4 py-2.5 font-medium">الحالة</th>
                <th className="px-4 py-2.5 font-medium">تاريخ الرفع</th>
                <th className="px-4 py-2.5 font-medium">الصفوف</th>
                <th className="px-4 py-2.5 font-medium">المُستورد</th>
                <th className="px-4 py-2.5 font-medium">المُستبعد</th>
                <th className="px-4 py-2.5 font-medium">أخطاء</th>
                <th className="px-4 py-2.5 font-medium">رفعه</th>
                <th className="px-4 py-2.5 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <TRow key={row.id}>
                  <TD>
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 flex-shrink-0 text-credit-600 dark:text-credit-400" />
                      <div className="min-w-0">
                        <span className="block truncate max-w-[200px] font-medium">
                          {row.fileName}
                        </span>
                        {row.profile && (
                          <span className="text-[10px] text-concrete-400">
                            {PROFILE_AR[row.profile] ?? row.profile}
                          </span>
                        )}
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <Badge tone={STATUS_BADGE[row.status]}>
                      {IMPORT_STATUS_AR[row.status] ?? row.status}
                    </Badge>
                  </TD>
                  <TD className="text-xs whitespace-nowrap">
                    {row.importedAt ? fmtDateTime(row.importedAt) : '—'}
                  </TD>
                  <TD className="tnum">{fmtNumber(row.txnsInFile)}</TD>
                  <TD className="tnum text-credit-700 dark:text-credit-400">
                    {fmtNumber(row.txnsInserted)}
                  </TD>
                  <TD className="tnum text-concrete-500">
                    {fmtNumber(row.txnsSkippedDuplicate)}
                  </TD>
                  <TD>
                    {row.errorsCount > 0 ? (
                      <button
                        onClick={() => openErrors(row.id)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-debt-600 hover:underline dark:text-debt-400"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        {row.errorsCount}
                      </button>
                    ) : (
                      <span className="tnum text-xs text-concrete-400">0</span>
                    )}
                  </TD>
                  <TD className="text-xs">{row.uploader.fullName}</TD>
                  <TD>
                    <div className="flex items-center gap-1">
                      {row.status === 'dry_run' && canRun && (
                        <button
                          onClick={() => executeMut.mutate(row.id)}
                          disabled={executeMut.isPending || row.executable === false}
                          className="rounded p-1.5 text-concrete-400 hover:bg-pine-50 hover:text-pine-700 dark:hover:bg-white/10 dark:hover:text-pine-100 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-concrete-400"
                          aria-label="تنفيذ الاستيراد"
                          title={
                            row.executable === false
                              ? 'التنفيذ متاح في المرحلة التالية (تخزين الأعمار)'
                              : 'تنفيذ الاستيراد'
                          }
                        >
                          <Play className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {row.status === 'completed' && (
                        <button
                          onClick={() => openReport(row.id)}
                          className="rounded p-1.5 text-concrete-400 hover:bg-concrete-100 hover:text-pine-700 dark:hover:bg-white/10 dark:hover:text-pine-100"
                          aria-label="عرض التقرير"
                          title="عرض التقرير"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {row.status === 'failed' && (
                        <button
                          onClick={() => openErrors(row.id)}
                          className="rounded p-1.5 text-concrete-400 hover:bg-debt-50 hover:text-debt-600 dark:hover:bg-debt-700/20 dark:hover:text-debt-400"
                          aria-label="عرض الأخطاء"
                          title="عرض الأخطاء"
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        </DataState>
      </Card>

      {/* ──── Dry-Run Preview Dialog ──── */}
      <PreviewDialog
        data={previewData}
        onClose={() => setPreviewData(null)}
        onExecute={() => {
          if (previewData) executeMut.mutate(previewData.jobId);
        }}
        executing={executeMut.isPending}
        canRun={canRun}
      />

      {/* ──── Report Dialog ──── */}
      <ReportDialog
        data={reportQuery.data ?? null}
        isLoading={reportQuery.isLoading}
        isError={reportQuery.isError}
        onClose={closeReport}
        open={reportOpen}
      />

      {/* ──── Error Details Dialog ──── */}
      <ErrorDialog
        data={errorQuery.data ?? null}
        isLoading={errorQuery.isLoading}
        isError={errorQuery.isError}
        onClose={closeErrors}
        open={errorOpen}
      />
    </div>
  );
}

/* ────────────────────────────── Upload Zone ──────────────────────────── */

function UploadZone({
  onFile,
  uploading,
}: {
  onFile: (file: File) => void;
  uploading: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setValidationError(null);
      try {
        validateFile(file);
        onFile(file);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'خطأ غير معروف';
        setValidationError(msg);
        toast(msg, 'err');
      }
    },
    [onFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  return (
    <>
      <input
        ref={inputRef}
        id="file-upload-input"
        type="file"
        accept=".xlsx,.xlsm,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !uploading && inputRef.current?.click()}
        className={`
          flex flex-col items-center justify-center gap-3 px-6 py-10
          border-2 border-dashed rounded-xl mx-4 my-4 cursor-pointer
          transition-colors
          ${
            uploading
              ? 'border-pine-300 bg-pine-50/50 dark:border-pine-700 dark:bg-pine-900/10 cursor-wait'
              : dragging
              ? 'border-pine-500 bg-pine-50 dark:border-pine-400 dark:bg-pine-900/20'
              : 'border-concrete-200 bg-concrete-50/50 hover:border-pine-300 hover:bg-pine-50/30 dark:border-white/10 dark:bg-iron-700/30 dark:hover:border-pine-600'
          }
        `}
        role="button"
        tabIndex={0}
        aria-label="اسحب ملف Excel هنا أو انقر للاختيار"
      >
        {uploading ? (
          <Skeleton className="h-16 w-16 rounded-full" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pine-100 dark:bg-pine-900/30">
            <Upload className="h-6 w-6 text-pine-600 dark:text-pine-300" />
          </div>
        )}
        <div className="text-center">
          <p className="text-sm font-medium text-concrete-700 dark:text-concrete-200">
            {uploading ? 'جارٍ رفع الملف ومراجعته…' : 'اسحب ملف Excel هنا أو انقر للاختيار'}
          </p>
          <p className="mt-1 text-xs text-concrete-500">
            يُقبل .xlsx و .xlsm و .xls (نصي مفصول بـ Tab — ترميز Windows-1256) بحد أقصى{' '}
            {MAX_SIZE_MB} ميجابايت
          </p>
        </div>
      </div>
      {validationError && (
        <p className="mx-4 -mt-2 mb-2 text-xs text-debt-600 dark:text-debt-400">{validationError}</p>
      )}
    </>
  );
}

/* ────────────────────────────── Preview Dialog ───────────────────────── */

function PreviewDialog({
  data,
  onClose,
  onExecute,
  executing,
  canRun,
}: {
  data: UploadResponse | null;
  onClose: () => void;
  onExecute: () => void;
  executing: boolean;
  canRun: boolean;
}) {
  if (!data) return null;
  const { preview } = data;
  const hasErrors = preview.parserErrors > 0 || preview.ruleErrors > 0;
  const isStatement = preview.profile === 'CUSTOMER_STATEMENT_DETAILS';
  const isMaster = preview.profile === 'CUSTOMER_MASTER';
  const isBalance = preview.profile === 'CUSTOMER_BALANCE_SUMMARY';
  const isAging =
    preview.profile === 'DEBT_AGING_SUMMARY' || preview.profile === 'DEBT_AGING_DETAILS';

  return (
    <Dialog open={!!data} onClose={onClose} title="مراجعة الاستيراد">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto">
        {/* ── Profile ── */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="pine">{PROFILE_AR[preview.profile] ?? preview.profile}</Badge>
          <Badge tone="neutral">
            {preview.format === 'tsv' ? 'نصي مفصول بـ Tab' : 'Excel'}
          </Badge>
        </div>

        {/* ── Previously imported warning ── */}
        {data.previouslyImported && (
          <div className="flex items-start gap-2 rounded-lg border border-hazard-300 bg-hazard-50 px-3 py-2 text-sm text-hazard-700 dark:border-hazard-600/30 dark:bg-hazard-700/20 dark:text-hazard-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>تم استيراد هذا الملف مسبقًا — تأكد من عدم التكرار قبل التنفيذ.</span>
          </div>
        )}

        {/* ── Deferred execution (aging) ── */}
        {!preview.executable && preview.deferredReason && (
          <div className="flex items-start gap-2 rounded-lg border border-hazard-300 bg-hazard-50 px-3 py-2 text-sm text-hazard-700 dark:border-hazard-600/30 dark:bg-hazard-700/20 dark:text-hazard-100">
            <Clock className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{preview.deferredReason}</span>
          </div>
        )}

        {/* ── Summary Stats ── */}
        {isStatement && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="الحسابات في الملف" value={preview.accountsInFile} />
            <StatCard label="العملاء في الملف" value={preview.customersInFile} />
            <StatCard label="المعاملات في الملف" value={preview.transactionsInFile} />
            <StatCard
              label="المعاملات القابلة للاستيراد"
              value={preview.importableTransactions}
              highlight
            />
          </div>
        )}
        {isMaster && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="العملاء في الملف" value={preview.customersInFile} />
            <StatCard label="قابلون للاستيراد" value={preview.importableCustomers ?? 0} highlight />
            <StatCard label="أخطاء تحليل" value={preview.parserErrors} />
            <StatCard label="أخطاء قواعد" value={preview.ruleErrors} />
          </div>
        )}
        {isBalance && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="العملاء في الملف" value={preview.customersInFile} />
            <StatCard label="أسطر الأرصدة" value={preview.balancesInFile ?? 0} />
            <StatCard label="قابلة للاستيراد" value={preview.importableBalances ?? 0} highlight />
            <StatCard
              label="العملات"
              value={(preview.currenciesInFile ?? []).join('، ') || '—'}
            />
          </div>
        )}
        {isAging && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="الصفوف في الملف" value={preview.agingRowsInFile ?? 0} />
            <StatCard label="العملاء في الملف" value={preview.customersInFile} />
            <StatCard
              label="العملات"
              value={(preview.currenciesInFile ?? []).join('، ') || '—'}
            />
            <StatCard label="المعاينة" value="متاحة" highlight />
          </div>
        )}

        {isStatement && preview.fragmentedAccountsMerged > 0 && (
          <p className="text-xs text-concrete-500">
            تم دمج {preview.fragmentedAccountsMerged} حسابات مجزأة.
          </p>
        )}

        {/* ── Errors ── */}
        {hasErrors && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-debt-700 dark:text-debt-400">
              أخطاء وجدت ({preview.parserErrors + preview.ruleErrors})
            </h3>
            {preview.parserErrorDetails.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-concrete-500">أخطاء التحليل:</p>
                <ul className="max-h-32 overflow-y-auto rounded-lg border border-concrete-100 bg-concrete-50 p-2 text-xs dark:border-white/10 dark:bg-iron-700">
                  {preview.parserErrorDetails.map((e, i) => (
                    <li key={i} className="py-0.5">
                      <span className="tnum font-medium">صف {e.rowNumber}:</span>{' '}
                      <span className="text-debt-600 dark:text-debt-400">{e.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.ruleErrorDetails.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-concrete-500">أخطاء القواعد:</p>
                <ul className="max-h-32 overflow-y-auto rounded-lg border border-concrete-100 bg-concrete-50 p-2 text-xs dark:border-white/10 dark:bg-iron-700">
                  {preview.ruleErrorDetails.map((e, i) => (
                    <li key={i} className="py-0.5">
                      <span className="tnum font-medium">صف {e.rowNumber}:</span>{' '}
                      <span className="text-debt-600 dark:text-debt-400">{e.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ── Sample Data: كشف الحساب ── */}
        {isStatement && preview.sampleAccounts.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-concrete-700 dark:text-concrete-200">
              عينة من البيانات
            </h3>
            <div className="space-y-3">
              {preview.sampleAccounts.map((acc) => (
                <div
                  key={acc.customerCode}
                  className="rounded-lg border border-concrete-100 bg-concrete-50 p-3 dark:border-white/10 dark:bg-iron-700"
                >
                  <div className="mb-2 flex items-center gap-2 text-sm">
                    <span className="font-medium">{acc.customerName}</span>
                    <span className="text-xs text-concrete-500" dir="ltr">
                      ({acc.customerCode})
                    </span>
                    <Badge tone="pine">{acc.currency}</Badge>
                  </div>
                  {acc.transactions.length > 0 && (
                    <Table>
                      <thead>
                        <tr className="text-right text-xs text-concrete-500">
                          <th className="pb-1 font-medium">صف</th>
                          <th className="pb-1 font-medium">التاريخ</th>
                          <th className="pb-1 font-medium">البيان</th>
                          <th className="pb-1 font-medium">مدين</th>
                          <th className="pb-1 font-medium">دائن</th>
                        </tr>
                      </thead>
                      <tbody>
                        {acc.transactions.map((t) => (
                          <tr key={t.rowNumber} className="text-xs">
                            <td className="tnum pb-1 pr-0">{t.rowNumber}</td>
                            <td className="pb-1 pr-2" dir="ltr">
                              {t.date}
                            </td>
                            <td className="max-w-[180px] truncate pb-1">{t.description}</td>
                            <td className="tnum pb-1 text-debt-600 dark:text-debt-400">
                              {t.debit != null ? t.debit.toLocaleString('en-US') : '—'}
                            </td>
                            <td className="tnum pb-1 text-credit-600 dark:text-credit-400">
                              {t.credit != null ? t.credit.toLocaleString('en-US') : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Sample Data: بيانات العملاء ── */}
        {isMaster && preview.sampleCustomers.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-concrete-700 dark:text-concrete-200">
              عينة من العملاء
            </h3>
            <Table>
              <thead>
                <tr className="text-right text-xs text-concrete-500">
                  <th className="pb-1 font-medium">الكود</th>
                  <th className="pb-1 font-medium">الاسم</th>
                  <th className="pb-1 font-medium">الجوال</th>
                  <th className="pb-1 font-medium">المنطقة</th>
                  <th className="pb-1 font-medium">النوع</th>
                </tr>
              </thead>
              <tbody>
                {preview.sampleCustomers.map((c) => (
                  <tr key={c.rowNumber} className="text-xs">
                    <td className="tnum pb-1 pr-0" dir="ltr">{c.customerCode}</td>
                    <td className="pb-1 pr-2">{c.customerName}</td>
                    <td className="pb-1" dir="ltr">{c.phone ?? '—'}</td>
                    <td className="pb-1">{c.region ?? '—'}</td>
                    <td className="pb-1">{c.customerType ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}

        {/* ── Sample Data: ملخص الأرصدة ── */}
        {isBalance && preview.sampleBalances.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-concrete-700 dark:text-concrete-200">
              عينة من الأرصدة
            </h3>
            <Table>
              <thead>
                <tr className="text-right text-xs text-concrete-500">
                  <th className="pb-1 font-medium">الكود</th>
                  <th className="pb-1 font-medium">الاسم</th>
                  <th className="pb-1 font-medium">العملة</th>
                  <th className="pb-1 font-medium">الرصيد</th>
                </tr>
              </thead>
              <tbody>
                {preview.sampleBalances.map((b) => (
                  <tr key={b.rowNumber} className="text-xs">
                    <td className="tnum pb-1 pr-0" dir="ltr">{b.customerCode}</td>
                    <td className="pb-1 pr-2">{b.customerName}</td>
                    <td className="pb-1">
                      <Badge tone="pine">{b.currency}</Badge>
                    </td>
                    <td className="tnum pb-1 font-medium">
                      {b.balance.toLocaleString('en-US')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}

        {/* ── Sample Data: تقسيم الأعمار ── */}
        {isAging && preview.sampleAgingRows.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-concrete-700 dark:text-concrete-200">
              عينة من الأعمار
            </h3>
            <Table>
              <thead>
                <tr className="text-right text-xs text-concrete-500">
                  {preview.profile === 'DEBT_AGING_DETAILS' && (
                    <>
                      <th className="pb-1 font-medium">الكود</th>
                      <th className="pb-1 font-medium">الاسم</th>
                    </>
                  )}
                  <th className="pb-1 font-medium">العملة</th>
                  {Object.keys(preview.sampleAgingRows[0].buckets).map((bk) => (
                    <th key={bk} className="pb-1 font-medium" dir="ltr">
                      {bk}
                    </th>
                  ))}
                  <th className="pb-1 font-medium">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {preview.sampleAgingRows.map((r) => (
                  <tr key={r.rowNumber} className="text-xs">
                    {preview.profile === 'DEBT_AGING_DETAILS' && (
                      <>
                        <td className="tnum pb-1 pr-0" dir="ltr">{r.customerCode}</td>
                        <td className="pb-1 pr-2">{r.customerName}</td>
                      </>
                    )}
                    <td className="pb-1">
                      <Badge tone="pine">{r.currency}</Badge>
                    </td>
                    {Object.keys(r.buckets).map((bk) => (
                      <td key={bk} className="tnum pb-1">
                        {r.buckets[bk].toLocaleString('en-US')}
                      </td>
                    ))}
                    <td className="tnum pb-1 font-medium">
                      {r.total != null ? r.total.toLocaleString('en-US') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="flex justify-end gap-2 border-t border-concrete-100 pt-3 dark:border-white/10">
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
          {canRun && (
            <Button
              onClick={onExecute}
              loading={executing}
              disabled={
                !preview.executable ||
                (isStatement && hasErrors && preview.importableTransactions === 0)
              }
            >
              <Play className="h-4 w-4" aria-hidden />
              تنفيذ الاستيراد
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/* ────────────────────────────── Report Dialog ────────────────────────── */

function ReportDialog({
  data,
  isLoading,
  isError,
  onClose,
  open,
}: {
  data: ReportData | null;
  isLoading: boolean;
  isError: boolean;
  onClose: () => void;
  open: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="تقرير الاستيراد">
      {isLoading && <Skeleton className="h-48" />}
      {isError && (
        <div className="space-y-3">
          <p className="text-sm text-debt-600 dark:text-debt-400">فشل تحميل التقرير</p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>إغلاق</Button>
          </div>
        </div>
      )}
      {data && (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* ── Status ── */}
          <div className="flex flex-wrap items-center gap-2">
            {data.status === 'completed' ? (
              <CheckCircle2 className="h-5 w-5 text-pine-600" />
            ) : (
              <XCircle className="h-5 w-5 text-debt-600" />
            )}
            <span className="text-sm font-medium">
              {data.status === 'completed' ? 'تم بنجاح' : 'فشل'}
            </span>
            {data.profile && (
              <Badge tone="pine">{PROFILE_AR[data.profile] ?? data.profile}</Badge>
            )}
          </div>

          {/* ── Main Counters ── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="الصفوف المقروءة" value={data.rowsRead} />
            <StatCard label="الصفوف المستوردة" value={data.rowsImported} highlight />
            <StatCard label="الصفوف المتجاهلة" value={data.rowsIgnored} />
            <StatCard label="عملاء جدد" value={data.customersNew} />
            <StatCard label="عملاء محدّثون" value={data.customersUpdated} />
            <StatCard label="معاملات جديدة" value={data.transactionsNew} highlight />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatCard label="معاملات مكررة" value={data.transactionsDuplicate} />
            <StatCard label="وقت التنفيذ" value={`${(data.durationMs / 1000).toFixed(1)} ث`} />
          </div>

          {data.balancesWritten != null && (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="أسطر الأرصدة المكتوبة" value={data.balancesWritten} highlight />
            </div>
          )}

          {/* ── Balance Changes ── */}
          {Object.keys(data.balancesAfter).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-concrete-700 dark:text-concrete-200">
                الأرصدة قبل/بعد
              </h3>
              <Table>
                <thead>
                  <tr className="text-right text-xs text-concrete-500">
                    <th className="pb-1 font-medium">العملة</th>
                    <th className="pb-1 font-medium">قبل</th>
                    <th className="pb-1 font-medium">بعد</th>
                    <th className="pb-1 font-medium">الفرق</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(data.balancesAfter).map((ccy) => {
                    const before = data.balancesBefore[ccy] ?? 0;
                    const after = data.balancesAfter[ccy];
                    const diff = after - before;
                    return (
                      <tr key={ccy} className="text-xs">
                        <td className="tnum pb-1 font-medium">{ccy}</td>
                        <td className="tnum pb-1">{before.toLocaleString('en-US')}</td>
                        <td className="tnum pb-1">{after.toLocaleString('en-US')}</td>
                        <td
                          className={
                            'tnum pb-1 font-medium ' +
                            (diff > 0
                              ? 'text-credit-600 dark:text-credit-400'
                              : diff < 0
                              ? 'text-debt-600 dark:text-debt-400'
                              : '')
                          }
                        >
                          {diff > 0 ? '+' : ''}
                          {diff.toLocaleString('en-US')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}

          {/* ── Misc counters ── */}
          {(data.duplicateNamePairsFlagged > 0 || data.reconciliationsOpened > 0) && (
            <div className="rounded-lg border border-concrete-100 bg-concrete-50 p-3 text-xs text-concrete-600 dark:border-white/10 dark:bg-iron-700 dark:text-concrete-400">
              {data.duplicateNamePairsFlagged > 0 && (
                <p>أزواج أسماء مكررة: {data.duplicateNamePairsFlagged}</p>
              )}
              {data.reconciliationsOpened > 0 && (
                <p>تسويات تم فتحها: {data.reconciliationsOpened}</p>
              )}
            </div>
          )}

          <div className="flex justify-end border-t border-concrete-100 pt-3 dark:border-white/10">
            <Button variant="secondary" onClick={onClose}>
              إغلاق
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/* ────────────────────────────── Error Dialog ─────────────────────────── */

function ErrorDialog({
  data,
  isLoading,
  isError,
  onClose,
  open,
}: {
  data: ErrorDetail | null;
  isLoading: boolean;
  isError: boolean;
  onClose: () => void;
  open: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="تفاصيل الأخطاء">
      {isLoading && <Skeleton className="h-48" />}
      {isError && (
        <div className="space-y-3">
          <p className="text-sm text-debt-600 dark:text-debt-400">فشل تحميل تفاصيل الأخطاء</p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>إغلاق</Button>
          </div>
        </div>
      )}
      {data && (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {data.profile && (
            <div className="flex items-center gap-2">
              <Badge tone="pine">{PROFILE_AR[data.profile] ?? data.profile}</Badge>
            </div>
          )}

          {data.deferredReason && (
            <div className="flex items-start gap-2 rounded-lg border border-hazard-300 bg-hazard-50 px-3 py-2 text-sm text-hazard-700 dark:border-hazard-600/30 dark:bg-hazard-700/20 dark:text-hazard-100">
              <Clock className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{data.deferredReason}</span>
            </div>
          )}

          {data.fatal && (
            <div className="flex items-start gap-2 rounded-lg border border-debt-600/20 bg-debt-50 px-3 py-2 text-sm text-debt-700 dark:border-debt-500/30 dark:bg-debt-700/20 dark:text-debt-50">
              <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{data.fatal}</span>
            </div>
          )}

          {data.parserErrors.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-concrete-700 dark:text-concrete-200">
                أخطاء التحليل ({data.parserErrors.length})
              </h3>
              <ul className="max-h-40 overflow-y-auto rounded-lg border border-concrete-100 bg-concrete-50 p-3 text-xs dark:border-white/10 dark:bg-iron-700">
                {data.parserErrors.map((e, i) => (
                  <li key={i} className="py-0.5">
                    <span className="tnum font-medium">صف {e.rowNumber}:</span>{' '}
                    <span className="text-debt-600 dark:text-debt-400">{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.ruleErrors.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-concrete-700 dark:text-concrete-200">
                أخطاء القواعد ({data.ruleErrors.length})
              </h3>
              <ul className="max-h-40 overflow-y-auto rounded-lg border border-concrete-100 bg-concrete-50 p-3 text-xs dark:border-white/10 dark:bg-iron-700">
                {data.ruleErrors.map((e, i) => (
                  <li key={i} className="py-0.5">
                    <span className="tnum font-medium">صف {e.rowNumber}:</span>{' '}
                    <span className="text-debt-600 dark:text-debt-400">{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.executeErrors.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-concrete-700 dark:text-concrete-200">
                أخطاء التنفيذ ({data.executeErrors.length})
              </h3>
              <ul className="max-h-40 overflow-y-auto rounded-lg border border-concrete-100 bg-concrete-50 p-3 text-xs dark:border-white/10 dark:bg-iron-700">
                {data.executeErrors.map((msg, i) => (
                  <li key={i} className="py-0.5 text-debt-600 dark:text-debt-400">{msg}</li>
                ))}
              </ul>
            </div>
          )}

          {data.accountWarnings.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-hazard-700 dark:text-hazard-100">
                تحذيرات ({data.accountWarnings.length})
              </h3>
              <ul className="max-h-40 overflow-y-auto rounded-lg border border-hazard-200 bg-hazard-50 p-3 text-xs dark:border-hazard-600/30 dark:bg-hazard-700/20">
                {data.accountWarnings.map((msg, i) => (
                  <li key={i} className="py-0.5">{msg}</li>
                ))}
              </ul>
            </div>
          )}

          {!data.fatal &&
            data.parserErrors.length === 0 &&
            data.ruleErrors.length === 0 &&
            data.executeErrors.length === 0 &&
            data.accountWarnings.length === 0 && (
              <p className="text-sm text-concrete-500">لا توجد أخطاء.</p>
            )}

          <div className="flex justify-end border-t border-concrete-100 pt-3 dark:border-white/10">
            <Button variant="secondary" onClick={onClose}>
              إغلاق
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/* ────────────────────────────── Stat Card ────────────────────────────── */

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        'rounded-lg border px-3 py-2 text-center dark:border-white/10 ' +
        (highlight
          ? 'border-pine-200 bg-pine-50 dark:bg-pine-900/20'
          : 'border-concrete-100 bg-concrete-50 dark:bg-iron-700')
      }
    >
      <p className="tnum text-lg font-bold text-concrete-800 dark:text-concrete-100">
        {typeof value === 'number' ? value.toLocaleString('en-US') : value}
      </p>
      <p className="text-xs text-concrete-500">{label}</p>
    </div>
  );
}
