'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, ShieldAlert, Users, KeyRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Card } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';

interface RoleListItem {
  id: string;
  name: string;
  isSystem: boolean;
  _count: { userRoles: number; rolePermissions: number };
}

interface Permission {
  id: string;
  code: string;
  descriptionAr: string;
}

interface RolePermissions {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: Permission[];
}

type PermissionGroup = {
  label: string;
  prefix: string;
  items: { code: string; label: string }[];
};

const PERMISSION_GROUPS: PermissionGroup[] = [
  { label: 'العملاء', prefix: 'customers.', items: [
    { code: 'customers.read', label: 'عرض العملاء' },
    { code: 'customers.read_all', label: 'عرض كل العملاء' },
    { code: 'customers.write', label: 'إضافة/تعديل العملاء' },
    { code: 'customers.transfer', label: 'نقل العملاء' },
  ]},
  { label: 'الأرصدة', prefix: 'balances.', items: [
    { code: 'balances.read', label: 'عرض الأرصدة' },
  ]},
  { label: 'التحصيلات', prefix: 'collections.', items: [
    { code: 'collections.create', label: 'تسجيل تحصيل' },
    { code: 'collections.reverse', label: 'عكس تحصيل' },
    { code: 'collections.approve', label: 'اعتماد تحصيل' },
  ]},
  { label: 'النقدية', prefix: 'cash.', items: [
    { code: 'cash.receive', label: 'استلام نقدية' },
  ]},
  { label: 'المتابعات', prefix: 'followups.', items: [
    { code: 'followups.create', label: 'إضافة متابعة' },
  ]},
  { label: 'الوعود', prefix: 'promises.', items: [
    { code: 'promises.create', label: 'إضافة وعد' },
  ]},
  { label: 'المهام', prefix: 'tasks.', items: [
    { code: 'tasks.manage', label: 'إدارة المهام' },
  ]},
  { label: 'الاستيراد', prefix: 'imports.', items: [
    { code: 'imports.run', label: 'تشغيل استيراد' },
    { code: 'imports.read', label: 'عرض الاستيرادات' },
  ]},
  { label: 'التسويات', prefix: 'reconciliation.', items: [
    { code: 'reconciliation.review', label: 'مراجعة التسويات' },
  ]},
  { label: 'التقارير', prefix: 'reports.', items: [
    { code: 'reports.read', label: 'عرض التقارير' },
    { code: 'reports.export', label: 'تصدير التقارير' },
  ]},
  { label: 'المستخدمون', prefix: 'users.', items: [
    { code: 'users.manage', label: 'إدارة المستخدمين' },
  ]},
  { label: 'الإعدادات', prefix: 'settings.', items: [
    { code: 'settings.manage', label: 'إدارة الإعدادات' },
  ]},
  { label: 'التدقيق', prefix: 'audit.', items: [
    { code: 'audit.read', label: 'عرض سجل العمليات' },
  ]},
  { label: 'المكررات', prefix: 'duplicates.', items: [
    { code: 'duplicates.review', label: 'مراجعة المكررات' },
  ]},
];

export default function RolesPage() {
  const can = useCan();
  const qc = useQueryClient();
  const canManage = can('users.manage');

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  const rolesQuery = useQuery<RoleListItem[]>({
    queryKey: ['roles'],
    queryFn: () => api<RoleListItem[]>('/roles'),
    enabled: canManage,
  });

  const rolePermsQuery = useQuery<RolePermissions>({
    queryKey: ['roles', selectedRoleId, 'permissions'],
    queryFn: () => api<RolePermissions>(`/roles/${selectedRoleId}/permissions`),
    enabled: canManage && !!selectedRoleId,
  });

  const addPermMut = useMutation({
    mutationFn: ({ roleId, permissionIds }: { roleId: string; permissionIds: string[] }) =>
      api(`/roles/${roleId}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ permissionIds }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles', selectedRoleId, 'permissions'] });
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const removePermMut = useMutation({
    mutationFn: ({ roleId, permissionId }: { roleId: string; permissionId: string }) =>
      api(`/roles/${roleId}/permissions/${permissionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles', selectedRoleId, 'permissions'] });
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  if (!canManage) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية إدارة الأدوار والصلاحيات" />
      </Card>
    );
  }

  const roles = rolesQuery.data ?? [];
  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const allPerms = rolePermsQuery.data?.permissions ?? [];
  const activePermCodes = new Set(allPerms.map((p) => p.code));

  const togglePermission = (permId: string, currentlyHas: boolean) => {
    if (!selectedRoleId) return;
    if (currentlyHas) {
      removePermMut.mutate({ roleId: selectedRoleId, permissionId: permId });
    } else {
      addPermMut.mutate({ roleId: selectedRoleId, permissionIds: [permId] });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="الأدوار والصلاحيات" />

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        {/* قائمة الأدوار */}
        <Card>
          <div className="border-b border-concrete-100 px-4 py-3 dark:border-white/10">
            <h3 className="font-display text-sm font-semibold">الأدوار</h3>
          </div>
          <DataState
            isLoading={rolesQuery.isLoading}
            isError={rolesQuery.isError}
            error={rolesQuery.error}
            onRetry={() => rolesQuery.refetch()}
            isFetching={rolesQuery.isFetching}
            isEmpty={!roles.length}
            emptyTitle="لا توجد أدوار"
            skeletonClassName="h-48"
          >
            <ul className="divide-y divide-concrete-100 dark:divide-white/10" role="listbox" aria-label="قائمة الأدوار">
              {roles.map((role) => (
                <li key={role.id}>
                  <button
                    role="option"
                    aria-selected={selectedRoleId === role.id}
                    onClick={() => setSelectedRoleId(role.id)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-right text-sm transition-colors hover:bg-pine-50/40 dark:hover:bg-white/5 ${
                      selectedRoleId === role.id
                        ? 'border-r-2 border-pine-700 bg-pine-50/60 dark:border-pine-100 dark:bg-white/10'
                        : ''
                    }`}
                  >
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      role.isSystem
                        ? 'bg-hazard-50 text-hazard-600 dark:bg-hazard-700/20 dark:text-hazard-100'
                        : 'bg-concrete-100 text-concrete-500 dark:bg-white/10 dark:text-concrete-300'
                    }`}>
                      {role.isSystem ? <ShieldAlert className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1 text-right">
                      <p className="font-medium truncate">{role.name}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-concrete-500">
                        <span className="inline-flex items-center gap-0.5">
                          <Users className="h-3 w-3" aria-hidden />
                          {role._count.userRoles}
                        </span>
                        <span className="inline-flex items-center gap-0.5">
                          <KeyRound className="h-3 w-3" aria-hidden />
                          {role._count.rolePermissions}
                        </span>
                      </div>
                    </div>
                    {role.isSystem && (
                      <Badge tone="hazard">نظام</Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </DataState>
        </Card>

        {/* صلاحيات الدور المحدد */}
        <Card>
          {!selectedRoleId ? (
            <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
              <Shield className="h-10 w-10 text-concrete-300 dark:text-concrete-500" aria-hidden />
              <p className="text-sm text-concrete-500">اختر دورًا لعرض صلاحياته</p>
            </div>
          ) : (
            <>
              <div className="border-b border-concrete-100 px-4 py-3 dark:border-white/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-sm font-semibold">{selectedRole?.name}</h3>
                    {selectedRole?.isSystem && (
                      <Badge tone="hazard">
                        <ShieldAlert className="ml-1 h-3 w-3" aria-hidden />
                        نظام
                      </Badge>
                    )}
                  </div>
                  {selectedRole?.isSystem && (
                    <p className="text-xs text-concrete-500">لأغراض التوثيق — لا يمكن حذف صلاحيات النظام الأساسية</p>
                  )}
                </div>
              </div>
              <DataState
                isLoading={rolePermsQuery.isLoading}
                isError={rolePermsQuery.isError}
                error={rolePermsQuery.error}
                onRetry={() => rolePermsQuery.refetch()}
                isFetching={rolePermsQuery.isFetching}
                isEmpty={false}
                skeletonClassName="h-64"
              >
                <div className="divide-y divide-concrete-100 dark:divide-white/10">
                  {PERMISSION_GROUPS.map((group) => {
                    const groupPerms = allPerms.filter((p) => p.code.startsWith(group.prefix));
                    if (groupPerms.length === 0) return null;
                    return (
                      <div key={group.prefix} className="px-4 py-3">
                        <h4 className="mb-2 text-xs font-semibold text-concrete-500 dark:text-concrete-400">
                          {group.label}
                        </h4>
                        <div className="space-y-1.5">
                          {groupPerms.map((perm) => {
                            const active = activePermCodes.has(perm.code);
                            const toggling = addPermMut.isPending || removePermMut.isPending;
                            return (
                              <div key={perm.id} className="flex items-center justify-between">
                                <span className="text-sm">{group.items.find((i) => i.code === perm.code)?.label ?? perm.code}</span>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={active}
                                  disabled={toggling}
                                  onClick={() => togglePermission(perm.id, active)}
                                  className={`relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 ${
                                    active
                                      ? 'bg-pine-700'
                                      : 'bg-concrete-200 dark:bg-white/20'
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                                      active ? 'translate-x-[22px]' : 'translate-x-[2px]'
                                    }`}
                                  />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </DataState>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
