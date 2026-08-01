'use client';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Lock, Shield, ToggleLeft, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { Badge, Button, Card, Field, Input, Select, Empty } from '@/components/ui/primitives';
import { Table, TRow, TD } from '@/components/ui/table';

/* ────────────────────────────── Types ────────────────────────────────── */

interface Branch {
  id: string;
  name: string;
}

interface Role {
  id: string;
  name: string;
  description: string | null;
}

interface UserItem {
  id: string;
  username: string;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  branch: Branch | null;
  roles: Role[];
}

/* ────────────────────────────── Helpers ──────────────────────────────── */

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/* ────────────────────────────── Validation Schemas ───────────────────── */

const createSchema = z.object({
  username: z.string().min(3, 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل'),
  fullName: z.string().min(1, 'الاسم الكامل مطلوب'),
  phone: z.string().optional(),
  password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
  branchId: z.string().optional(),
  roleIds: z.array(z.string()).optional(),
});
type CreateForm = z.infer<typeof createSchema>;

const editSchema = z.object({
  username: z
    .string()
    .min(3, 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل')
    .regex(/^[a-zA-Z0-9._-]+$/, 'يسمح فقط بالأحرف اللاتينية والأرقام و . _ -'),
  fullName: z.string().min(1, 'الاسم الكامل مطلوب'),
  phone: z.string().optional(),
  branchId: z.string().optional(),
});
type EditForm = z.infer<typeof editSchema>;

const resetPasswordSchema = z.object({
  password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
});
type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

/* ────────────────────────────── Main Page ────────────────────────────── */

export default function UsersPage() {
  const can = useCan();
  const canManage = can('users.manage');
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 350);

  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<UserItem | null>(null);
  const [statusItem, setStatusItem] = useState<UserItem | null>(null);
  const [resetPwItem, setResetPwItem] = useState<UserItem | null>(null);
  const [rolesItem, setRolesItem] = useState<UserItem | null>(null);

  const query = useQuery<UserItem[]>({
    queryKey: ['users', debouncedSearch],
    queryFn: () => api<UserItem[]>('/users'),
    enabled: canManage,
  });

  const rolesQuery = useQuery<Role[]>({
    queryKey: ['roles'],
    queryFn: () => api<Role[]>('/roles'),
    enabled: canManage,
  });

  const branchesQuery = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: () => api<Branch[]>('/branches'),
    enabled: canManage,
  });

  const items = query.data ?? [];
  const filtered = debouncedSearch
    ? items.filter((u) => {
        const s = debouncedSearch.toLowerCase();
        return (
          u.username.toLowerCase().includes(s) ||
          u.fullName.toLowerCase().includes(s) ||
          (u.phone?.toLowerCase().includes(s) ?? false) ||
          (u.branch?.name.toLowerCase().includes(s) ?? false)
        );
      })
    : items;

  const createMut = useMutation({
    mutationFn: (data: CreateForm) =>
      api<UserItem>('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: data.username,
          fullName: data.fullName,
          phone: data.phone || undefined,
          password: data.password,
          branchId: data.branchId || undefined,
          roleIds: (data.roleIds?.length ? data.roleIds : undefined) as string[] | undefined,
        }),
      }),
    onSuccess: () => {
      toast('تم إنشاء المستخدم بنجاح', 'ok');
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const editMut = useMutation({
    mutationFn: async ({ id, currentUsername, username, ...data }: EditForm & { id: string; currentUsername: string }) => {
      if (username !== currentUsername) {
        await api<UserItem>(`/users/${id}/username`, {
          method: 'PATCH',
          body: JSON.stringify({ username }),
        });
      }
      return api<UserItem>(`/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: data.fullName,
          phone: data.phone || undefined,
          branchId: data.branchId || undefined,
        }),
      });
    },
    onSuccess: () => {
      toast('تم تعديل المستخدم بنجاح', 'ok');
      setEditItem(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const statusMut = useMutation({
    mutationFn: (id: string) => api<UserItem>(`/users/${id}/status`, { method: 'PATCH' }),
    onSuccess: () => {
      toast('تم تغيير حالة المستخدم بنجاح', 'ok');
      setStatusItem(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const resetPwMut = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api(`/users/${id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: password }),
      }),
    onSuccess: () => {
      toast('تم إعادة تعيين كلمة المرور بنجاح', 'ok');
      setResetPwItem(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const grantRolesMut = useMutation({
    mutationFn: ({ id, roleIds }: { id: string; roleIds: string[] }) =>
      api(`/users/${id}/roles`, {
        method: 'POST',
        body: JSON.stringify({ roleIds }),
      }),
    onSuccess: () => {
      toast('تم منح الأدوار بنجاح', 'ok');
      setRolesItem(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const revokeRoleMut = useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      api(`/users/${userId}/roles/${roleId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('تم سحب الدور بنجاح', 'ok');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  if (!canManage) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية إدارة المستخدمين" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="المستخدمين"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            مستخدم جديد
          </Button>
        }
      />

      <Card>
        <div className="border-b border-concrete-100 px-4 py-3 dark:border-white/10">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-concrete-400" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث باسم المستخدم، الاسم الكامل، أو رقم الهاتف…"
              className="pr-10 pl-9"
              aria-label="بحث في المستخدمين"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-concrete-100 dark:hover:bg-white/10"
                aria-label="مسح البحث"
              >
                <X className="h-3.5 w-3.5 text-concrete-400" />
              </button>
            )}
          </div>
        </div>

        <DataState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
          isFetching={query.isFetching}
          isEmpty={!filtered.length}
          emptyTitle="لا يوجد مستخدمين"
          emptyHint={debouncedSearch ? 'جرّب تغيير معايير البحث' : undefined}
          skeletonClassName="h-64"
        >
          {query.data && (
            <Table>
              <thead>
                <tr className="border-b border-concrete-100 text-right text-xs text-concrete-500 dark:border-white/10 dark:text-concrete-400">
                  <th className="px-4 py-2.5 font-medium">اسم المستخدم</th>
                  <th className="px-4 py-2.5 font-medium">الاسم الكامل</th>
                  <th className="px-4 py-2.5 font-medium">الهاتف</th>
                  <th className="px-4 py-2.5 font-medium">الفرع</th>
                  <th className="px-4 py-2.5 font-medium">الأدوار</th>
                  <th className="px-4 py-2.5 font-medium">الحالة</th>
                  <th className="px-4 py-2.5 font-medium">تاريخ الإنشاء</th>
                  <th className="px-4 py-2.5 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <TRow key={u.id}>
                    <TD>
                      <span className="dir-ltr font-medium text-concrete-900 dark:text-concrete-100">{u.username}</span>
                    </TD>
                    <TD className="text-concrete-700 dark:text-concrete-200">{u.fullName}</TD>
                    <TD>
                      <span className="dir-ltr text-concrete-600 dark:text-concrete-400">{u.phone ?? '—'}</span>
                    </TD>
                    <TD className="text-concrete-600 dark:text-concrete-400">
                      {u.branch?.name ?? '—'}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.length > 0 ? (
                          u.roles.map((r) => (
                            <Badge key={r.id} tone="pine">{r.name}</Badge>
                          ))
                        ) : (
                          <span className="text-xs text-concrete-400">—</span>
                        )}
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={u.isActive ? 'credit' : 'debt'}>
                        {u.isActive ? 'نشط' : 'موقوف'}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-concrete-500 dark:text-concrete-400">
                      {fmtDate(u.createdAt)}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditItem(u)}
                          className="rounded p-1.5 text-concrete-400 hover:bg-concrete-100 hover:text-pine-700 dark:hover:bg-white/10 dark:hover:text-pine-100"
                          aria-label="تعديل المستخدم"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setStatusItem(u)}
                          className="rounded p-1.5 text-concrete-400 hover:bg-concrete-100 hover:text-credit-600 dark:hover:bg-white/10 dark:hover:text-credit-400"
                          aria-label={u.isActive ? 'إيقاف المستخدم' : 'تفعيل المستخدم'}
                        >
                          <ToggleLeft className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setResetPwItem(u)}
                          className="rounded p-1.5 text-concrete-400 hover:bg-concrete-100 hover:text-hazard-600 dark:hover:bg-white/10 dark:hover:text-hazard-400"
                          aria-label="إعادة تعيين كلمة المرور"
                        >
                          <Lock className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setRolesItem(u)}
                          className="rounded p-1.5 text-concrete-400 hover:bg-concrete-100 hover:text-pine-700 dark:hover:bg-white/10 dark:hover:text-pine-100"
                          aria-label="إدارة الأدوار"
                        >
                          <Shield className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </DataState>
      </Card>

      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        branches={branchesQuery.data ?? []}
        roles={rolesQuery.data ?? []}
        onSubmit={(data) => createMut.mutate(data)}
        loading={createMut.isPending}
      />

      <EditDialog
        item={editItem}
        onClose={() => setEditItem(null)}
        branches={branchesQuery.data ?? []}
        onSubmit={(data) => editMut.mutate({ ...data, id: editItem!.id, currentUsername: editItem!.username })}
        loading={editMut.isPending}
      />

      <StatusDialog
        item={statusItem}
        onClose={() => setStatusItem(null)}
        onConfirm={() => statusMut.mutate(statusItem!.id)}
        loading={statusMut.isPending}
      />

      <ResetPasswordDialog
        item={resetPwItem}
        onClose={() => setResetPwItem(null)}
        onSubmit={(data) => resetPwMut.mutate({ id: resetPwItem!.id, ...data })}
        loading={resetPwMut.isPending}
      />

      <ManageRolesDialog
        item={rolesItem}
        onClose={() => setRolesItem(null)}
        roles={rolesQuery.data ?? []}
        onGrant={(roleIds) => grantRolesMut.mutate({ id: rolesItem!.id, roleIds })}
        onRevoke={(roleId) => revokeRoleMut.mutate({ userId: rolesItem!.id, roleId })}
        granting={grantRolesMut.isPending}
        revoking={revokeRoleMut.isPending}
      />
    </div>
  );
}

/* ────────────────────────────── Create Dialog ────────────────────────── */

function CreateDialog({
  open, onClose, branches, roles, onSubmit, loading,
}: {
  open: boolean;
  onClose: () => void;
  branches: Branch[];
  roles: Role[];
  onSubmit: (data: CreateForm) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { roleIds: [] },
  });

  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) {
      reset();
      setSelectedRoleIds([]);
    }
  }, [open, reset]);

  const toggleRole = (roleId: string) => {
    setSelectedRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  };

  const handleFormSubmit = (data: CreateForm) => {
    onSubmit({ ...data, roleIds: selectedRoleIds });
  };

  return (
    <Dialog open={open} onClose={onClose} title="إنشاء مستخدم جديد">
      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="اسم المستخدم *" error={errors.username?.message}>
            <Input placeholder="أدخل اسم المستخدم…" {...register('username')} />
          </Field>
          <Field label="الاسم الكامل *" error={errors.fullName?.message}>
            <Input placeholder="أدخل الاسم الكامل…" {...register('fullName')} />
          </Field>
        </div>

        <Field label="رقم الهاتف" error={errors.phone?.message}>
          <Input placeholder="أدخل رقم الهاتف…" dir="ltr" {...register('phone')} />
        </Field>

        <Field label="كلمة المرور *" error={errors.password?.message}>
          <Input type="password" placeholder="أدخل كلمة المرور…" {...register('password')} />
        </Field>

        <Field label="الفرع" error={errors.branchId?.message}>
          <Select {...register('branchId')}>
            <option value="">بدون فرع</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </Field>

        <div className="space-y-1.5">
          <span className="text-sm font-medium text-concrete-700 dark:text-concrete-200">الأدوار</span>
          {roles.length === 0 ? (
            <p className="text-xs text-concrete-500">لا توجد أدوار متاحة</p>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-concrete-200 bg-white p-2 dark:border-white/10 dark:bg-iron-800">
              {roles.map((r) => (
                <label
                  key={r.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-concrete-50 dark:hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    checked={selectedRoleIds.includes(r.id)}
                    onChange={() => toggleRole(r.id)}
                    className="rounded border-concrete-300 text-pine-700 focus:ring-pine-500"
                  />
                  <span>{r.name}</span>
                  {r.description && (
                    <span className="text-xs text-concrete-500">{r.description}</span>
                  )}
                </label>
              ))}
            </div>
          )}
          <input type="hidden" {...register('roleIds')} value={selectedRoleIds} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={loading}>
            <Plus className="h-4 w-4" aria-hidden />
            إنشاء المستخدم
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ────────────────────────────── Edit Dialog ──────────────────────────── */

function EditDialog({
  item, onClose, branches, onSubmit, loading,
}: {
  item: UserItem | null;
  onClose: () => void;
  branches: Branch[];
  onSubmit: (data: EditForm) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
  });

  useEffect(() => {
    if (item) {
      reset({
        username: item.username,
        fullName: item.fullName,
        phone: item.phone ?? '',
        branchId: item.branch?.id ?? '',
      });
    }
  }, [item, reset]);

  return (
    <Dialog open={!!item} onClose={onClose} title={`تعديل المستخدم — ${item?.username ?? ''}`}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field label="اسم المستخدم *" error={errors.username?.message} hint="فريد — لا يمكن التكرار مع مستخدم آخر">
          <Input placeholder="أدخل اسم المستخدم…" {...register('username')} />
        </Field>

        <Field label="الاسم الكامل *" error={errors.fullName?.message}>
          <Input placeholder="أدخل الاسم الكامل…" {...register('fullName')} />
        </Field>

        <Field label="رقم الهاتف" error={errors.phone?.message}>
          <Input placeholder="أدخل رقم الهاتف…" dir="ltr" {...register('phone')} />
        </Field>

        <Field label="الفرع" error={errors.branchId?.message}>
          <Select {...register('branchId')}>
            <option value="">بدون فرع</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={loading}>
            حفظ التعديلات
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ────────────────────────────── Status Dialog ────────────────────────── */

function StatusDialog({
  item, onClose, onConfirm, loading,
}: {
  item: UserItem | null;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <Dialog open={!!item} onClose={onClose} title="تغيير حالة المستخدم">
      <div className="space-y-4">
        <p className="text-sm text-concrete-600 dark:text-concrete-400">
          {item?.isActive
            ? 'هل أنت متأكد من إيقاف هذا المستخدم؟'
            : 'هل أنت متأكد من تفعيل هذا المستخدم؟'}
        </p>
        {item && (
          <div className="rounded-lg border border-concrete-100 bg-concrete-50 p-3 text-sm dark:border-white/10 dark:bg-iron-700">
            <p><span className="font-medium">اسم المستخدم:</span> {item.username}</p>
            <p><span className="font-medium">الاسم الكامل:</span> {item.fullName}</p>
            <p>
              <span className="font-medium">الحالة الحالية:</span>{' '}
              <Badge tone={item.isActive ? 'credit' : 'debt'}>
                {item.isActive ? 'نشط' : 'موقوف'}
              </Badge>
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button
            variant={item?.isActive ? 'danger' : 'success'}
            onClick={onConfirm}
            loading={loading}
          >
            <ToggleLeft className="h-4 w-4" aria-hidden />
            {item?.isActive ? 'إيقاف' : 'تفعيل'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ────────────────────────────── Reset Password Dialog ─────────────────── */

function ResetPasswordDialog({
  item, onClose, onSubmit, loading,
}: {
  item: UserItem | null;
  onClose: () => void;
  onSubmit: (data: ResetPasswordForm) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
  });

  useEffect(() => {
    if (!item) reset();
  }, [item, reset]);

  return (
    <Dialog open={!!item} onClose={onClose} title={`إعادة تعيين كلمة المرور — ${item?.username ?? ''}`}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-sm text-concrete-500">
          سيتم تعيين كلمة مرور جديدة للمستخدم <strong>{item?.fullName}</strong>.
        </p>

        <Field label="كلمة المرور الجديدة *" error={errors.password?.message}>
          <Input type="password" placeholder="أدخل كلمة المرور الجديدة…" {...register('password')} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={loading}>
            <Lock className="h-4 w-4" aria-hidden />
            تعيين كلمة المرور
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ────────────────────────────── Manage Roles Dialog ───────────────────── */

function ManageRolesDialog({
  item, onClose, roles, onGrant, onRevoke, granting, revoking,
}: {
  item: UserItem | null;
  onClose: () => void;
  roles: Role[];
  onGrant: (roleIds: string[]) => void;
  onRevoke: (roleId: string) => void;
  granting: boolean;
  revoking: boolean;
}) {
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const userRoleIds = item?.roles.map((r) => r.id) ?? [];
  const availableRoles = roles.filter((r) => !userRoleIds.includes(r.id));

  useEffect(() => {
    if (!item) setSelectedRoleIds([]);
  }, [item]);

  const toggleRole = (roleId: string) => {
    setSelectedRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  };

  const handleGrant = () => {
    if (!selectedRoleIds.length) return;
    onGrant(selectedRoleIds);
  };

  return (
    <Dialog open={!!item} onClose={onClose} title={`إدارة الأدوار — ${item?.username ?? ''}`}>
      <div className="space-y-4">
        {/* الأدوار الحالية */}
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-concrete-700 dark:text-concrete-200">الأدوار الحالية</span>
          {item && item.roles.length > 0 ? (
            <div className="space-y-1">
              {item.roles.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border border-concrete-100 bg-concrete-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-iron-700"
                >
                  <div>
                    <span className="font-medium">{r.name}</span>
                    {r.description && (
                      <span className="mr-2 text-xs text-concrete-500">{r.description}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRevoke(r.id)}
                    disabled={revoking}
                    className="text-xs text-debt-600 hover:underline disabled:opacity-50"
                  >
                    سحب
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-concrete-500">لا يملك هذا المستخدم أي أدوار.</p>
          )}
        </div>

        {/* منح أدوار جديدة */}
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-concrete-700 dark:text-concrete-200">منح أدوار جديدة</span>
          {availableRoles.length === 0 ? (
            <p className="text-xs text-concrete-500">جميع الأدوار ممنوحة بالفعل.</p>
          ) : (
            <>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-concrete-200 bg-white p-2 dark:border-white/10 dark:bg-iron-800">
                {availableRoles.map((r) => (
                  <label
                    key={r.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-concrete-50 dark:hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRoleIds.includes(r.id)}
                      onChange={() => toggleRole(r.id)}
                      className="rounded border-concrete-300 text-pine-700 focus:ring-pine-500"
                    />
                    <span>{r.name}</span>
                    {r.description && (
                      <span className="mr-1 text-xs text-concrete-500">{r.description}</span>
                    )}
                  </label>
                ))}
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleGrant}
                  disabled={!selectedRoleIds.length}
                  loading={granting}
                >
                  <Shield className="h-4 w-4" aria-hidden />
                  منح الأدوار المحددة
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>إغلاق</Button>
        </div>
      </div>
    </Dialog>
  );
}
