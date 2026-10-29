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

function timestamp(value: unknown): number {
  return value ? new Date(String(value)).getTime() : 0;
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
