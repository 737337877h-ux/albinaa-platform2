const TASK_PRIORITY: Record<string, number> = {
  promise_overdue: 1,
  promise_escalation: 1,
  escalation_legal_120: 1.5,
  promise_due_today: 2,
  promise_due: 2,
  escalation_visit_90: 2.5,
  followup_overdue: 3,
  risk_critical: 4,
  account_group_risk_critical: 4,
  escalation_call_60: 4.5,
  risk_high: 5,
  account_group_risk_high: 5,
  large_debt_7plus: 6,
  escalation_message_30: 6.5,
  debt_120plus: 7,
  high_balance_no_followup: 8,
  account_group_priority: 8,
  repeated_no_answer: 9,
  needs_visit: 10,
  followup_periodic_medium: 11,
  followup_normal: 12,
};

export function isDailyPriority(taskType: unknown): boolean {
  return ['followup_overdue', 'risk_critical', 'risk_high', 'large_debt_7plus',
    'debt_120plus', 'high_balance_no_followup', 'repeated_no_answer', 'needs_visit',
    'followup_periodic_medium', 'followup_normal', 'escalation_message_30',
    'escalation_call_60', 'escalation_visit_90', 'escalation_legal_120',
    'account_group_priority', 'account_group_risk_critical', 'account_group_risk_high',
  ].includes(String(taskType ?? ''));
}

function timestamp(value: unknown): number {
  return value ? new Date(String(value)).getTime() : 0;
}

export function taskDateKey(value: unknown): string {
  if (!value) return '';
  const raw = String(value);
  const direct = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

/** عمل اليوم يعرض المهام المستحقة في تاريخ اليوم فقط؛ الأقدم تظهر في المتأخرة. */
export function isDueForTodayWork(value: unknown, todayKey: string): boolean {
  const due = taskDateKey(value);
  return Boolean(due && due === todayKey);
}

export function todayTaskViews<T extends {id:string; customerId?:string|null; taskType?:string|null; priority?:string|null; title?:string|null; dueDate?:string|Date|null; status?:string|null; priorityReason?:string|null}>(items:T[], today:string, focusedId?:string|null) {
  const due = items.filter(t => ['open','pending','',null,undefined].includes(t.status) && isDueForTodayWork(t.dueDate,today));
  const key = (t:T) => t.customerId || `task:${t.id}`;
  const manual = collapseTasksByCustomer(due.filter(t=>!isDailyPriority(t.taskType||t.priority)),focusedId);
  const automatic = collapseTasksByCustomer(due.filter(t=>isDailyPriority(t.taskType||t.priority)),focusedId);
  const manualByKey = new Map(manual.map(t=>[key(t),t]));
  const automaticByKey = new Map(automatic.map(t=>[key(t),t]));
  const decorate = (rows:T[]) => rows.map(t=>({...t,hasManual:manualByKey.has(key(t)),hasAutomatic:automaticByKey.has(key(t)),manualReason:manualByKey.get(key(t))?.priorityReason||manualByKey.get(key(t))?.title,automaticReason:automaticByKey.get(key(t))?.priorityReason||automaticByKey.get(key(t))?.title}));
  return {all:decorate(collapseTasksByCustomer(due,focusedId)),manual:decorate(manual),automatic:decorate(automatic)};
}

export function collapseTasksByCustomer<T extends {
  id: string;
  customerId?: string | null;
  taskType?: string | null;
  priority?: string | null;
  dueDate?: string | Date | null;
  createdAt?: string | Date | null;
}>(tasks: T[], focusedTaskId?: string | null): T[] {
  const selected = new Map<string, T>();

  for (const task of tasks) {
    const key = task.customerId || `task:${task.id}`;
    const current = selected.get(key);
    if (!current) {
      selected.set(key, task);
      continue;
    }

    const taskFocused = String(task.id) === focusedTaskId;
    const currentFocused = String(current.id) === focusedTaskId;
    const taskPriority = TASK_PRIORITY[task.taskType || task.priority || ''] ?? 100;
    const currentPriority = TASK_PRIORITY[current.taskType || current.priority || ''] ?? 100;
    const taskIsBetter = (taskFocused && !currentFocused)
      || (taskFocused === currentFocused && taskPriority < currentPriority)
      || (taskFocused === currentFocused && taskPriority === currentPriority
        && timestamp(task.dueDate) > timestamp(current.dueDate))
      || (taskFocused === currentFocused && taskPriority === currentPriority
        && timestamp(task.dueDate) === timestamp(current.dueDate)
        && timestamp(task.createdAt) > timestamp(current.createdAt));
    if (taskIsBetter) selected.set(key, task);
  }

  return [...selected.values()];
}
