'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { Badge, Button, Card, Field, Select } from '@/components/ui/primitives';
import { Table, THead, TRow, TD } from '@/components/ui/table';

interface Collector {
  id: string;
  user: { id: string; username: string; fullName: string; phone: string; isActive: boolean };
  branch: { id: string; name: string } | null;
  active: boolean;
}

interface User {
  id: string;
  username: string;
  fullName: string;
  phone: string;
  isActive: boolean;
}

interface Branch {
  id: string;
  name: string;
}

const createSchema = z.object({
  userId: z.string().min(1, 'يرجى اختيار مستخدم'),
  branchId: z.string().optional(),
});

const editSchema = z.object({
  branchId: z.string().optional(),
  active: z.boolean(),
});

type CreateForm = z.infer<typeof createSchema>;
type EditForm = z.infer<typeof editSchema>;

export default function CollectorsPage() {
  const can = useCan();
  const canManage = can('users.manage');
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<Collector | null>(null);

  const collectors = useQuery<Collector[]>({
    queryKey: ['collectors'],
    queryFn: () => api<Collector[]>('/collectors'),
    enabled: canManage,
  });

  const users = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api<User[]>('/users'),
    enabled: canManage,
  });

  const branches = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: () => api<Branch[]>('/branches'),
    enabled: canManage,
  });

  const availableUsers = users.data?.filter(
    (u) => !collectors.data?.some((c) => c.user.id === u.id),
  ) ?? [];

  const createMut = useMutation({
    mutationFn: (data: CreateForm) =>
      api<Collector>('/collectors', {
        method: 'POST',
        body: JSON.stringify({
          userId: data.userId,
          branchId: data.branchId || undefined,
        }),
      }),
    onSuccess: () => {
      toast('تم إضافة المحصل بنجاح', 'ok');
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ['collectors'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const editMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: EditForm }) =>
      api<Collector>(`/collectors/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          branchId: data.branchId || undefined,
          active: data.active,
        }),
      }),
    onSuccess: () => {
      toast('تم تحديث المحصل بنجاح', 'ok');
      setEditItem(null);
      qc.invalidateQueries({ queryKey: ['collectors'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  if (!canManage) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية إدارة المستخدمين (users.manage)" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="المحصلون"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            محصل جديد
          </Button>
        }
      />

      <Card>
        <DataState
          isLoading={collectors.isLoading}
          isError={collectors.isError}
          error={collectors.error}
          onRetry={() => collectors.refetch()}
          isFetching={collectors.isFetching}
          isEmpty={!collectors.data?.length}
          emptyTitle="لا يوجد محصلون"
          skeletonClassName="h-64"
        >
          {collectors.data && (
            <Table>
              <THead cols={['اسم المستخدم', 'الاسم الكامل', 'الهاتف', 'الفرع', 'حالة المستخدم', 'حالة المحصل', '']} />
              <tbody>
                {collectors.data.map((c) => (
                  <TRow key={c.id}>
                    <TD className="font-medium">{c.user.username}</TD>
                    <TD className="text-concrete-600 dark:text-concrete-400">{c.user.fullName}</TD>
                    <TD className="text-xs text-concrete-500"><span dir="ltr">{c.user.phone}</span></TD>
                    <TD className="text-concrete-600 dark:text-concrete-400">{c.branch?.name ?? '—'}</TD>
                    <TD>
                      <Badge tone={c.user.isActive ? 'pine' : 'neutral'}>
                        {c.user.isActive ? 'نشط' : 'غير نشط'}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge tone={c.active ? 'pine' : 'neutral'}>
                        {c.active ? 'نشط' : 'غير نشط'}
                      </Badge>
                    </TD>
                    <TD>
                      <button
                        onClick={() => setEditItem(c)}
                        className="rounded p-1.5 text-concrete-400 hover:bg-pine-50 hover:text-pine-600 dark:hover:bg-white/10 dark:hover:text-pine-400"
                        aria-label="تعديل المحصل"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
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
        users={availableUsers}
        branches={branches.data ?? []}
        branchesLoading={branches.isLoading}
        onSubmit={(data) => createMut.mutate(data)}
        loading={createMut.isPending}
      />

      <EditDialog
        item={editItem}
        onClose={() => setEditItem(null)}
        branches={branches.data ?? []}
        branchesLoading={branches.isLoading}
        onSubmit={(data) => {
          if (editItem) editMut.mutate({ id: editItem.id, data });
        }}
        loading={editMut.isPending}
      />
    </div>
  );
}

function CreateDialog({
  open, onClose, users, branches, branchesLoading, onSubmit, loading,
}: {
  open: boolean;
  onClose: () => void;
  users: User[];
  branches: Branch[];
  branchesLoading: boolean;
  onSubmit: (data: CreateForm) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
  });

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} title="إضافة محصل جديد">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field label="المستخدم *" error={errors.userId?.message}>
          <Select {...register('userId')}>
            <option value="">اختر مستخدم…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} (@{u.username})
              </option>
            ))}
          </Select>
        </Field>

        <Field label="الفرع" hint="اختياري — يمكن تركه فارغاً">
          <Select {...register('branchId')} disabled={branchesLoading}>
            <option value="">بدون فرع</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={handleClose}>إلغاء</Button>
          <Button type="submit" loading={loading}>
            <Plus className="h-4 w-4" aria-hidden />
            إضافة المحصل
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditDialog({
  item, onClose, branches, branchesLoading, onSubmit, loading,
}: {
  item: Collector | null;
  onClose: () => void;
  branches: Branch[];
  branchesLoading: boolean;
  onSubmit: (data: EditForm) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    values: item ? { branchId: item.branch?.id ?? '', active: item.active } : undefined,
  });

  const active = watch('active');

  const handleClose = () => {
    reset();
    onClose();
  };

  if (!item) return null;

  return (
    <Dialog open={!!item} onClose={handleClose} title="تعديل المحصل">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* User info (read-only) */}
        <div className="rounded-lg bg-concrete-50 p-3 dark:bg-white/5">
          <p className="text-sm font-medium text-concrete-700 dark:text-concrete-200">{item.user.fullName}</p>
          <p className="text-xs text-concrete-500" dir="ltr">@{item.user.username}</p>
        </div>

        <Field label="الفرع" hint="اختياري — يمكن تركه فارغاً">
          <Select {...register('branchId')} disabled={branchesLoading}>
            <option value="">بدون فرع</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="حالة المحصل">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={active ? 'primary' : 'secondary'}
              onClick={() => setValue('active', true, { shouldValidate: true })}
            >
              نشط
            </Button>
            <Button
              type="button"
              variant={!active ? 'danger' : 'secondary'}
              onClick={() => setValue('active', false, { shouldValidate: true })}
            >
              غير نشط
            </Button>
          </div>
          {errors.active && (
            <span role="alert" className="block text-xs text-debt-600 dark:text-debt-500 mt-1">
              {errors.active.message}
            </span>
          )}
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
