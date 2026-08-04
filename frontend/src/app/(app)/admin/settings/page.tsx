'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { toast } from '@/components/ui/toast';
import { Button, Card, Input, Select, Textarea } from '@/components/ui/primitives';
import { DEFAULT_MESSAGE_TEMPLATES, MessageTemplate, parseMessageTemplates } from '@/lib/messaging';

/* ────────────────────────────── Types ────────────────────────────────── */

interface SettingItem {
  key: string;
  value: unknown;
}

interface SettingDef {
  key: string;
  label: string;
  description: string;
  type: 'number' | 'boolean' | 'string';
  defaultValue: string;
}

interface SettingsGroup {
  title: string;
  items: SettingDef[];
}

/* ────────────────────────── Setting Definitions ───────────────────────── */

const GROUPS: SettingsGroup[] = [
  {
    title: 'المهام الذكية والأولويات',
    items: [
      {
        key: 'smartTasks.enabled',
        label: 'تشغيل التوليد التلقائي',
        description: 'إنشاء قائمة عمل ذكية مرة يوميًا عند فتح لوحة المعلومات، مع منع التكرار.',
        type: 'boolean',
        defaultValue: 'true',
      },
      {
        key: 'smartTasks.minDebtAgeDays',
        label: 'الحد الأدنى لعمر المديونية',
        description: 'إعطاء أولوية للمديونيات الكبيرة التي مر عليها هذا العدد من الأيام.',
        type: 'number',
        defaultValue: '7',
      },
      {
        key: 'smartTasks.highBalanceTopPercent',
        label: 'نسبة أعلى الأرصدة',
        description: 'اعتبار أعلى نسبة من أرصدة كل عملة مديونيات كبيرة ذات أولوية.',
        type: 'number',
        defaultValue: '10',
      },
      {
        key: 'smartTasks.followupStaleDays',
        label: 'أيام انقطاع المتابعة',
        description: 'عدد الأيام قبل اعتبار العميل بحاجة إلى متابعة جديدة.',
        type: 'number',
        defaultValue: '7',
      },
    ],
  },
  {
    title: 'مدة الجلسة',
    items: [
      {
        key: 'session.timeout',
        label: 'المهلة (دقائق)',
        description: 'مدة بقاء الجلسة نشطة قبل تسجيل الخروج تلقائيًا',
        type: 'number',
        defaultValue: '60',
      },
      {
        key: 'session.maxDevices',
        label: 'أقصى عدد أجهزة',
        description: 'الحد الأقصى للأجهزة التي يمكنها تسجيل الدخول في وقت واحد',
        type: 'number',
        defaultValue: '1',
      },
    ],
  },
  {
    title: 'إعدادات التحصيل',
    items: [
      {
        key: 'collection.requireReceipt',
        label: 'إلزامية الإيصال',
        description: 'طلب إدخال رقم الإيصال عند تسجيل التحصيل',
        type: 'boolean',
        defaultValue: 'false',
      },
      {
        key: 'collection.maxAmount',
        label: 'الحد الأقصى للمبلغ',
        description: 'أقصى مبلغ مسموح به في عملية تحصيل واحدة',
        type: 'number',
        defaultValue: '100000',
      },
    ],
  },
  {
    title: 'إعدادات الاستيراد',
    items: [
      {
        key: 'import.maxFileSize',
        label: 'الحد الأقصى لحجم الملف (MB)',
        description: 'أقصى حجم مسموح به لملفات Excel المستوردة',
        type: 'number',
        defaultValue: '30',
      },
      {
        key: 'import.allowedFormats',
        label: 'الصيغ المسموحة',
        description: 'امتدادات الملفات المسموح برفعها (مفصولة بفواصل)',
        type: 'string',
        defaultValue: '.xlsx,.xlsm,.xls',
      },
    ],
  },
  {
    title: 'إعدادات الإشعارات',
    items: [
      {
        key: 'notifications.reminderEnabled',
        label: 'التذكير التلقائي',
        description: 'إرسال تذكيرات تلقائية للوعود المستحقة',
        type: 'boolean',
        defaultValue: 'true',
      },
      {
        key: 'notifications.reminderHour',
        label: 'ساعة التذكير',
        description: 'الساعة التي تُرسل فيها التذكيرات اليومية (0-23)',
        type: 'number',
        defaultValue: '8',
      },
    ],
  },
];

/* ────────────────────────────── Helpers ──────────────────────────────── */

function parseValue(value: string | undefined, def: SettingDef): string {
  return value ?? def.defaultValue;
}

/* ────────────────────────────── Main Page ────────────────────────────── */

export default function SettingsPage() {
  const can = useCan();
  const canManage = can('settings.manage');
  const qc = useQueryClient();

  /* ──── Query ──── */
  const query = useQuery<SettingItem[]>({
    queryKey: ['settings'],
    queryFn: () => api<SettingItem[]>('/settings'),
    enabled: canManage,
  });

  /* ──── Local State ──── */
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (query.data) {
      const map: Record<string, string> = {};
      for (const s of query.data) map[s.key] = typeof s.value === 'string' ? s.value : String(s.value);
      setValues((prev) => {
        const merged = { ...map };
        for (const k of Object.keys(prev)) {
          if (dirty[k]) merged[k] = prev[k];
        }
        return merged;
      });
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [query.data]);

  const updateValue = (key: string, val: string) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    setDirty((prev) => ({ ...prev, [key]: true }));
  };

  const resetGroup = (keys: string[]) => {
    setValues((prev) => {
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
    setDirty((prev) => {
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  };

  /* ──── Save Mutation ──── */
  const saveMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      api(`/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ key, value }),
      }),
    onSuccess: (_data, { key }) => {
      toast('تم حفظ الإعداد بنجاح', 'ok');
      setDirty((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setSavingKeys((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: Error, { key }) => {
      toast(err.message, 'err');
      setSavingKeys((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
  });

  const saveSetting = (key: string, value: string) => {
    setSavingKeys((prev) => ({ ...prev, [key]: true }));
    saveMut.mutate({ key, value });
  };

  /* ──── Permission Gate ──── */
  if (!canManage) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية إدارة الإعدادات (settings.manage)" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="الإعدادات" />

      <DataState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        isFetching={query.isFetching}
        isEmpty={false}
        emptyTitle=""
        skeletonClassName="h-64"
      >
        <div className="space-y-5">
          {GROUPS.map((group) => {
            const groupDirty = group.items.some((item) => dirty[item.key]);

            return (
              <Card key={group.title}>
                <div className="border-b border-concrete-100 px-4 py-3 dark:border-white/10">
                  <h3 className="font-display text-sm font-semibold">{group.title}</h3>
                </div>

                <div className="divide-y divide-concrete-100 dark:divide-white/10">
                  {group.items.map((def) => {
                    const currentVal = parseValue(values[def.key], def);
                    const isDirty = !!dirty[def.key];
                    const saving = !!savingKeys[def.key];

                    return (
                      <div
                        key={def.key}
                        className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex-1 space-y-0.5">
                          <p className="text-sm font-medium text-concrete-700 dark:text-concrete-200">
                            {def.label}
                          </p>
                          <p className="text-xs text-concrete-500">{def.description}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          {def.type === 'boolean' ? (
                            <ToggleSwitch
                              checked={currentVal === 'true'}
                              onChange={(checked) =>
                                updateValue(def.key, checked ? 'true' : 'false')
                              }
                              disabled={saving}
                            />
                          ) : def.type === 'number' ? (
                            <Input
                              type="number"
                              value={currentVal}
                              onChange={(e) => updateValue(def.key, e.target.value)}
                              className="w-24 text-left"
                              dir="ltr"
                              disabled={saving}
                            />
                          ) : (
                            <Input
                              type="text"
                              value={currentVal}
                              onChange={(e) => updateValue(def.key, e.target.value)}
                              className="w-40"
                              disabled={saving}
                            />
                          )}

                          {isDirty && (
                            <button
                              onClick={() => saveSetting(def.key, currentVal)}
                              disabled={saving}
                              className="rounded p-1.5 text-concrete-400 hover:bg-pine-50 hover:text-pine-700 dark:hover:bg-white/10 dark:hover:text-pine-100 disabled:opacity-50"
                              aria-label="حفظ"
                            >
                              <Save className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {groupDirty && (
                  <div className="flex justify-end gap-2 border-t border-concrete-100 px-4 py-3 dark:border-white/10">
                    <Button
                      variant="secondary"
                      onClick={() => resetGroup(group.items.map((i) => i.key))}
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden />
                      إلغاء التغييرات
                    </Button>
                    <Button
                      onClick={() => {
                        for (const item of group.items) {
                          if (dirty[item.key]) {
                            saveSetting(item.key, parseValue(values[item.key], item));
                          }
                        }
                      }}
                    >
                      <Save className="h-4 w-4" aria-hidden />
                      حفظ الكل
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
          <MessageTemplatesSettings initial={query.data?.find((s) => s.key === 'communication.templates')?.value} />
        </div>
      </DataState>
    </div>
  );
}

function MessageTemplatesSettings({ initial }: { initial: unknown }) {
  const qc = useQueryClient();
  const [templates, setTemplates] = useState<MessageTemplate[]>(DEFAULT_MESSAGE_TEMPLATES);
  const [saving, setSaving] = useState(false);

  useEffect(() => setTemplates(parseMessageTemplates(initial)), [initial]);

  const update = (id: string, patch: Partial<MessageTemplate>) =>
    setTemplates((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));

  const save = async () => {
    setSaving(true);
    try {
      await api('/settings/communication.templates', {
        method: 'PUT', body: JSON.stringify({ key: 'communication.templates', value: templates }),
      });
      await qc.invalidateQueries({ queryKey: ['settings'] });
      toast('تم حفظ قوالب التواصل', 'ok');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'تعذر حفظ القوالب', 'err');
    } finally { setSaving(false); }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-concrete-100 px-4 py-3 dark:border-white/10">
        <div>
          <h3 className="font-display text-sm font-semibold">قوالب واتساب والرسائل النصية</h3>
          <p className="mt-1 text-xs text-concrete-500">المتغيرات: {'{اسم_العميل}'}، {'{الرصيد}'}، {'{العملة}'}، {'{أقدم_دين_بالأيام}'}، {'{اسم_المحصل}'}، {'{رقم_الحجز}'}، {'{تاريخ_الاستحقاق}'}</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setTemplates((items) => [...items, {
          id: `template-${Date.now()}`, name: 'قالب جديد', channel: 'both', body: 'مرحبًا {اسم_العميل}،', active: true,
        }])}><Plus className="h-4 w-4" /> إضافة قالب</Button>
      </div>
      <div className="space-y-4 p-4">
        {templates.map((template) => (
          <div key={template.id} className="rounded-xl border border-concrete-100 p-3 dark:border-white/10">
            <div className="grid gap-3 md:grid-cols-[1fr_160px_auto_auto]">
              <Input value={template.name} onChange={(e) => update(template.id, { name: e.target.value })} aria-label="اسم القالب" />
              <Select value={template.channel} onChange={(e) => update(template.id, { channel: e.target.value as MessageTemplate['channel'] })}>
                <option value="both">واتساب وSMS</option><option value="whatsapp">واتساب</option><option value="sms">SMS</option>
              </Select>
              <ToggleSwitch checked={template.active} onChange={(active) => update(template.id, { active })} />
              <button type="button" className="rounded-lg p-2 text-debt-600 hover:bg-debt-50" aria-label="حذف القالب" onClick={() => setTemplates((items) => items.filter((item) => item.id !== template.id))}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <Textarea className="mt-3" rows={3} value={template.body} onChange={(e) => update(template.id, { body: e.target.value })} aria-label="نص القالب" />
          </div>
        ))}
        <div className="flex justify-end"><Button onClick={save} loading={saving}><Save className="h-4 w-4" /> حفظ القوالب</Button></div>
      </div>
    </Card>
  );
}

/* ────────────────────────────── Toggle Switch ────────────────────────── */

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      dir="ltr"
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-pine-700' : 'bg-concrete-300 dark:bg-white/20',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-[4px]',
        )}
      />
    </button>
  );
}
