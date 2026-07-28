'use client';
import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Card, Input, Pagination, Select } from '@/components/ui/primitives';
import { Table, TRow, TD } from '@/components/ui/table';

/* ────────────────────────────── Constants ────────────────────────────── */

const ACTION_AR: Record<string, string> = {
  user_created: 'إنشاء مستخدم',
  user_updated: 'تعديل مستخدم',
  user_enabled: 'تفعيل مستخدم',
  user_disabled: 'تعطيل مستخدم',
  user_password_reset: 'إعادة تعيين كلمة مرور',
  user_roles_granted: 'منح أدوار',
  user_role_revoked: 'سحب دور',
  role_permissions_granted: 'إضافة صلاحيات',
  role_permission_revoked: 'سحب صلاحية',
  branch_created: 'إنشاء فرع',
  branch_updated: 'تعديل فرع',
  branch_enabled: 'تفعيل فرع',
  branch_disabled: 'إيقاف فرع',
  currency_updated: 'تعديل عملة',
  setting_created: 'إضافة إعداد',
  setting_updated: 'تحديث إعداد',
  setting_deleted: 'حذف إعداد',
  login_success: 'دخول ناجح',
  login_failed: 'فشل دخول',
  logout: 'خروج',
  collection_created: 'تحصيل',
  collection_reversed: 'عكس تحصيل',
  followup_created: 'متابعة',
  promise_created: 'وعد سداد',
  import_uploaded: 'استيراد',
  import_executed: 'تنفيذ استيراد',
  customer_created: 'إنشاء عميل',
  customer_updated: 'تعديل عميل',
};

const ENTITY_TABLES = [
  'users',
  'branches',
  'roles',
  'currencies',
  'settings',
  'customers',
  'collections',
  'followups',
  'promises',
  'imports',
  'auth',
];

function actionBadgeTone(action: string): 'pine' | 'neutral' | 'hazard' | 'debt' | 'credit' {
  if (action.startsWith('user_') || action.startsWith('customer_')) {
    if (action.includes('created')) return 'pine';
    if (action.includes('updated') || action.includes('enabled')) return 'credit';
    if (action.includes('disabled') || action.includes('revoked') || action.includes('reset')) return 'hazard';
    return 'neutral';
  }
  if (action.startsWith('login_')) return action === 'login_success' ? 'credit' : 'debt';
  if (action.startsWith('collection_')) return action === 'collection_reversed' ? 'debt' : 'credit';
  if (action.startsWith('role_')) return 'neutral';
  if (action.startsWith('branch_')) return action.includes('disabled') ? 'debt' : 'pine';
  if (action.startsWith('setting_') || action.startsWith('currency_')) return 'neutral';
  if (action.startsWith('import_')) return action === 'import_executed' ? 'pine' : 'neutral';
  return 'neutral';
}

function formatJson(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return val;
    }
  }
  return JSON.stringify(val, null, 2);
}

/* ────────────────────────────── Types ────────────────────────────────── */

interface AuditLog {
  id: string;
  userId: string;
  action: string;
  entityTable: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  user: { fullName: string };
}

interface AuditResponse {
  items: AuditLog[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/* ────────────────────────────── Main Page ────────────────────────────── */

export default function AuditPage() {
  const can = useCan();
  const canRead = can('audit.read');

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityTable, setEntityTable] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const query = useQuery<AuditResponse>({
    queryKey: ['audit', from, to, actionFilter, entityTable, userSearch, page],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('page', String(page));
      p.set('limit', '25');
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      if (actionFilter) p.set('action', actionFilter);
      if (entityTable) p.set('entityTable', entityTable);
      if (userSearch) p.set('userId', userSearch);
      return api<AuditResponse>(`/audit?${p.toString()}`);
    },
    enabled: canRead,
  });

  if (!canRead) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية عرض سجل العمليات (audit.read)" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="سجل العمليات" />

      <Card>
        <div className="border-b border-concrete-100 px-4 py-3 dark:border-white/10">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">نوع العملية</span>
              <Select
                value={actionFilter}
                onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
              >
                <option value="">الكل</option>
                {Object.entries(ACTION_AR).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">الجدول</span>
              <Select
                value={entityTable}
                onChange={(e) => { setEntityTable(e.target.value); setPage(1); }}
              >
                <option value="">الكل</option>
                {ENTITY_TABLES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">المستخدم</span>
              <Input
                value={userSearch}
                onChange={(e) => { setUserSearch(e.target.value); setPage(1); }}
                placeholder="ابحث باسم المستخدم…"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">من تاريخ</span>
              <Input
                type="date"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setPage(1); }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">إلى تاريخ</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => { setTo(e.target.value); setPage(1); }}
              />
            </label>
          </div>
        </div>

        <DataState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
          isFetching={query.isFetching}
          isEmpty={!query.data?.items?.length}
          emptyTitle="لا توجد عمليات"
          emptyHint={from || to || actionFilter || entityTable || userSearch ? 'جرّب تغيير معايير البحث أو الفلاتر' : undefined}
          skeletonClassName="h-64"
        >
          <Table>
            <thead>
              <tr className="border-b border-concrete-100 text-right text-xs text-concrete-500 dark:border-white/10 dark:text-concrete-400">
                <th className="px-4 py-2.5 font-medium">التاريخ</th>
                <th className="px-4 py-2.5 font-medium">المستخدم</th>
                <th className="px-4 py-2.5 font-medium">العملية</th>
                <th className="px-4 py-2.5 font-medium">الجدول</th>
                <th className="px-4 py-2.5 font-medium">المعرف</th>
                <th className="px-4 py-2.5 font-medium">IP</th>
                <th className="px-4 py-2.5 font-medium">التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.items.map((log) => {
                const isExpanded = expanded.has(log.id);
                const hasDetails = log.oldValue || log.newValue || log.reason;
                return (
                  <Fragment key={log.id}>
                    <TRow>
                      <TD className="whitespace-nowrap text-xs">{fmtDateTime(log.createdAt)}</TD>
                      <TD className="text-sm">{log.user.fullName}</TD>
                      <TD>
                        <Badge tone={actionBadgeTone(log.action)}>
                          {ACTION_AR[log.action] ?? log.action}
                        </Badge>
                      </TD>
                      <TD className="text-xs text-concrete-600 dark:text-concrete-400">{log.entityTable}</TD>
                      <TD className="font-mono text-xs"><span dir="ltr">{log.entityId}</span></TD>
                      <TD className="font-mono text-xs"><span dir="ltr">{log.ipAddress}</span></TD>
                      <TD>
                        {hasDetails ? (
                          <button
                            onClick={() => toggleExpand(log.id)}
                            className="inline-flex items-center gap-1 text-xs text-pine-700 hover:underline dark:text-pine-100"
                          >
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            {isExpanded ? 'إخفاء' : 'عرض'}
                          </button>
                        ) : (
                          <span className="text-concrete-400">—</span>
                        )}
                      </TD>
                    </TRow>
                    {isExpanded && (
                      <tr className="border-b border-concrete-100 dark:border-white/10">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="space-y-3 rounded-lg bg-concrete-50 p-3 text-xs dark:bg-iron-700">
                            {log.reason && (
                              <div>
                                <span className="font-medium text-concrete-600 dark:text-concrete-400">السبب:</span>
                                <p className="mt-0.5 whitespace-pre-wrap text-concrete-800 dark:text-concrete-200">
                                  {log.reason}
                                </p>
                              </div>
                            )}
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {log.oldValue != null && log.oldValue !== '' && (
                                <div>
                                  <span className="font-medium text-concrete-600 dark:text-concrete-400">القيمة القديمة:</span>
                                  <pre
                                    dir="ltr"
                                    className="mt-0.5 overflow-x-auto rounded border border-concrete-200 bg-white p-2 font-mono text-[11px] leading-relaxed dark:border-white/10 dark:bg-iron-800"
                                  >
                                    {formatJson(log.oldValue)}
                                  </pre>
                                </div>
                              )}
                              {log.newValue != null && log.newValue !== '' && (
                                <div>
                                  <span className="font-medium text-concrete-600 dark:text-concrete-400">القيمة الجديدة:</span>
                                  <pre
                                    dir="ltr"
                                    className="mt-0.5 overflow-x-auto rounded border border-concrete-200 bg-white p-2 font-mono text-[11px] leading-relaxed dark:border-white/10 dark:bg-iron-800"
                                  >
                                    {formatJson(log.newValue)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
          <Pagination page={query.data?.page ?? 1} totalPages={query.data?.totalPages ?? 1} onPage={setPage} />
        </DataState>
      </Card>

      {query.data && (
        <p className="text-center text-xs text-concrete-400">
          إجمالي النتائج: {query.data.total} عملية — الصفحة {query.data.page} من {query.data.totalPages}
        </p>
      )}
    </div>
  );
}
