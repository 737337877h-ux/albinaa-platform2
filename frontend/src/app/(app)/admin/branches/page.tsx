'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, ToggleLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { Badge, Button, Card, Field, Input } from '@/components/ui/primitives';
import { Table, THead, TRow, TD } from '@/components/ui/table';

interface BranchCount {
  users: number;
  customers: number;
  collectors: number;
}

interface Branch {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  _count: BranchCount;
}

const branchSchema = z.object({
  name: z.string().min(1, 'اسم الفرع مطلوب'),
});

type BranchForm = z.infer<typeof branchSchema>;

export default function BranchesPage() {
  const can = useCan();
  const canManage = can('settings.manage');
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<Branch | null>(null);
  const [toggleItem, setToggleItem] = useState<Branch | null>(null);

  const query = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: () => api<Branch[]>('/branches'),
    enabled: canManage,
  });

  const createMut = useMutation({
    mutationFn: (data: BranchForm) =>
      api<Branch>('/branches', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast('تم إنشاء الفرع بنجاح', 'ok');
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const editMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: BranchForm }) =>
      api<Branch>(`/branches/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast('تم تحديث الفرع بنجاح', 'ok');
      setEditItem(null);
      qc.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/branches/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => {
      toast('تم تغيير حالة الفرع بنجاح', 'ok');
      setToggleItem(null);
      qc.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  if (!canManage) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية إدارة الفروع (settings.manage)" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="الفروع"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            فرع جديد
          </Button>
        }
      />

      <Card>
        <DataState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
          isFetching={query.isFetching}
          isEmpty={!query.data?.length}
          emptyTitle="لا توجد فروع"
          skeletonClassName="h-64"
        >
          {query.data && (
            <Table>
              <THead cols={['الفرع', 'المستخدمين', 'العملاء', 'المحصلين', 'الحالة', 'تاريخ الإنشاء', 'إجراءات']} />
              <tbody>
                {query.data.map((b) => (
                  <TRow key={b.id}>
                    <TD className="font-medium">{b.name}</TD>
                    <TD className="text-concrete-600 dark:text-concrete-400">{b._count.users}</TD>
                    <TD className="text-concrete-600 dark:text-concrete-400">{b._count.customers}</TD>
                    <TD className="text-concrete-600 dark:text-concrete-400">{b._count.collectors}</TD>
                    <TD>
                      <Badge tone={b.active ? 'pine' : 'neutral'}>
                        {b.active ? 'نشط' : 'غير نشط'}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-concrete-500">{fmtDate(b.createdAt)}</TD>
                    <TD>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditItem(b)}
                          className="rounded p-1.5 text-concrete-400 hover:bg-pine-50 hover:text-pine-600 dark:hover:bg-white/10 dark:hover:text-pine-400"
                          aria-label="تعديل الفرع"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setToggleItem(b)}
                          className="rounded p-1.5 text-concrete-400 hover:bg-hazard-50 hover:text-hazard-600 dark:hover:bg-white/10 dark:hover:text-hazard-400"
                          aria-label={b.active ? 'تعطيل الفرع' : 'تفعيل الفرع'}
                        >
                          <ToggleLeft className="h-3.5 w-3.5" />
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
        onSubmit={(data) => createMut.mutate(data)}
        loading={createMut.isPending}
      />

      <EditDialog
        item={editItem}
        onClose={() => setEditItem(null)}
        onSubmit={(data) => {
          if (editItem) editMut.mutate({ id: editItem.id, data });
        }}
        loading={editMut.isPending}
      />

      <ToggleDialog
        item={toggleItem}
        onClose={() => setToggleItem(null)}
        onSubmit={(active) => {
          if (toggleItem) toggleMut.mutate({ id: toggleItem.id, active });
        }}
        loading={toggleMut.isPending}
      />
    </div>
  );
}

function CreateDialog({
  open, onClose, onSubmit, loading,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: BranchForm) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<BranchForm>({
    resolver: zodResolver(branchSchema),
  });

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} title="إضافة فرع جديد">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field label="اسم الفرع *" error={errors.name?.message}>
          <Input placeholder="أدخل اسم الفرع…" {...register('name')} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={handleClose}>إلغاء</Button>
          <Button type="submit" loading={loading}>
            <Plus className="h-4 w-4" aria-hidden />
            إضافة الفرع
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditDialog({
  item, onClose, onSubmit, loading,
}: {
  item: Branch | null;
  onClose: () => void;
  onSubmit: (data: BranchForm) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<BranchForm>({
    resolver: zodResolver(branchSchema),
    values: item ? { name: item.name } : undefined,
  });

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={!!item} onClose={handleClose} title="تعديل الفرع">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field label="اسم الفرع *" error={errors.name?.message}>
          <Input placeholder="أدخل اسم الفرع…" {...register('name')} />
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

function ToggleDialog({
  item, onClose, onSubmit, loading,
}: {
  item: Branch | null;
  onClose: () => void;
  onSubmit: (active: boolean) => void;
  loading: boolean;
}) {
  if (!item) return null;
  const newActive = !item.active;

  return (
    <Dialog open={!!item} onClose={onClose} title={item.active ? 'تعطيل الفرع' : 'تفعيل الفرع'}>
      <div className="space-y-4">
        <p className="text-sm text-concrete-600 dark:text-concrete-400">
          {item.active
            ? `هل أنت متأكد من تعطيل الفرع "${item.name}"؟`
            : `هل أنت متأكد من تفعيل الفرع "${item.name}"؟`
          }
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button
            variant={item.active ? 'danger' : 'success'}
            onClick={() => onSubmit(newActive)}
            loading={loading}
          >
            <ToggleLeft className="h-4 w-4" aria-hidden />
            {item.active ? 'تعطيل' : 'تفعيل'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
