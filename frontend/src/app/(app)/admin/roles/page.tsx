'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Shield, ShieldAlert, Users, KeyRound, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Button, Card, Field, Input } from '@/components/ui/primitives';
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
    { code: 'imports.reverse', label: 'التراجع عن استيراد' },
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
    { code: 'duplicates.merge', label: 'دمج العملاء والتراجع' },
  ]},
];

const createRoleSchema = z.object({
  name: z.string().min(2, 'اسم الدور يجب أن يكون حرفين على الأقل').max(100, 'اسم الدور طويل جداً'),
});
type CreateRoleForm = z.infer<typeof createRoleSchema>;

const updateRoleSchema = z.object({
  name: z.string().min(2, 'اسم الدور يجب أن يكون حرفين على الأقل').max(100, 'اسم الدور طويل جداً'),
});
type UpdateRoleForm = z.infer<typeof updateRoleSchema>;

export default function RolesPage() {
  const can = useCan();
  const qc = useQueryClient();
  const canManage = can('users.manage');

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editRole, setEditRole] = useState<RoleListItem | null>(null);
  const [deleteRole, setDeleteRole] = useState<RoleListItem | null>(null);

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

  const createRoleMut = useMutation({
    mutationFn: (data: CreateRoleForm) =>
      api('/roles', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast('تم إنشاء الدور بنجاح', 'ok');
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const updateRoleMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateRoleForm }) =>
      api(`/roles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast('تم تعديل الدور بنجاح', 'ok');
      setEditRole(null);
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const deleteRoleMut = useMutation({
    mutationFn: (id: string) =>
      api(`/roles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('تم حذف الدور بنجاح', 'ok');
      setDeleteRole(null);
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
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
      <PageHeader
        title="الأدوار والصلاحيات"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            دور جديد
          </Button>
        }
      />

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
                  <div className="flex w-full items-center gap-2">
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
                    {!role.isSystem && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditRole(role)}
                          className="rounded p-1.5 text-concrete-400 hover:bg-pine-50 hover:text-pine-600 dark:hover:bg-white/10 dark:hover:text-pine-400"
                          aria-label="تعديل الدور"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteRole(role)}
                          className="rounded p-1.5 text-concrete-400 hover:bg-debt-50 hover:text-debt-600 dark:hover:bg-white/10 dark:hover:text-debt-400"
                          aria-label="حذف الدور"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
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

      <CreateRoleDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(data) => createRoleMut.mutate(data)}
        loading={createRoleMut.isPending}
      />

      <EditRoleDialog
        role={editRole}
        onClose={() => setEditRole(null)}
        onSubmit={(data) => updateRoleMut.mutate({ id: editRole!.id, data })}
        loading={updateRoleMut.isPending}
      />

      <DeleteRoleDialog
        role={deleteRole}
        onClose={() => setDeleteRole(null)}
        onConfirm={() => deleteRoleMut.mutate(deleteRole!.id)}
        loading={deleteRoleMut.isPending}
      />
    </div>
  );
}

function CreateRoleDialog({
  open, onClose, onSubmit, loading,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CreateRoleForm) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateRoleForm>({
    resolver: zodResolver(createRoleSchema),
  });

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} title="إنشاء دور جديد">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field label="اسم الدور *" error={errors.name?.message}>
          <Input placeholder="أدخل اسم الدور…" {...register('name')} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={handleClose}>إلغاء</Button>
          <Button type="submit" loading={loading}>
            <Plus className="h-4 w-4" aria-hidden />
            إنشاء الدور
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditRoleDialog({
  role, onClose, onSubmit, loading,
}: {
  role: RoleListItem | null;
  onClose: () => void;
  onSubmit: (data: UpdateRoleForm) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<UpdateRoleForm>({
    resolver: zodResolver(updateRoleSchema),
  });

  const handleClose = () => {
    reset();
    onClose();
  };

  if (!role) return null;

  return (
    <Dialog open={!!role} onClose={handleClose} title={`تعديل الدور — ${role.name}`}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field label="اسم الدور *" error={errors.name?.message}>
          <Input placeholder="أدخل اسم الدور…" {...register('name')} defaultValue={role.name} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={handleClose}>إلغاء</Button>
          <Button type="submit" loading={loading}>
            <Pencil className="h-4 w-4" aria-hidden />
            حفظ التعديلات
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteRoleDialog({
  role, onClose, onConfirm, loading,
}: {
  role: RoleListItem | null;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  if (!role) return null;

  return (
    <Dialog open={!!role} onClose={onClose} title="حذف الدور">
      <div className="space-y-4">
        <p className="text-sm text-concrete-600 dark:text-concrete-400">
          هل أنت متأكد من حذف دور <strong>{role.name}</strong>؟
        </p>
        {role._count.userRoles > 0 && (
          <p className="text-sm text-debt-600 dark:text-debt-400">
            هذا الدور مرتبط بـ {role._count.userRoles} مستخدم — لا يمكن حذفه إلا بعد إزالة الدور من جميع المستخدمين.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button variant="danger" onClick={onConfirm} loading={loading} disabled={role._count.userRoles > 0}>
            <Trash2 className="h-4 w-4" aria-hidden />
            حذف الدور
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
