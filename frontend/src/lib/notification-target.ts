export interface TargetableNotification {
  kind: string;
  payload?: Record<string, unknown>;
}

export function notificationHref(notification: TargetableNotification): string {
  const payload = notification.payload ?? {};
  if (
    notification.kind === 'finance_alert' &&
    (payload.event === 'financial_adjustment_requested' || payload.event === 'financial_adjustment_reviewed')
  ) {
    const status = typeof payload.decision === 'string' ? `&status=${payload.decision}` : '';
    return `/admin/financial-adjustments${payload.requestId ? `?requestId=${payload.requestId}${status}` : ''}`;
  }
  if (typeof payload.href === 'string' && payload.href.startsWith('/')) return payload.href;
  if (typeof payload.targetUrl === 'string' && payload.targetUrl.startsWith('/')) return payload.targetUrl;
  if (notification.kind === 'collection_reversal_requested') {
    return `/collections/reconciliation${payload.requestId ? `?requestId=${payload.requestId}` : ''}`;
  }
  if (notification.kind === 'assignment_change_requested') {
    return `/admin/assignments${payload.requestId ? `?requestId=${payload.requestId}` : ''}`;
  }
  if (notification.kind === 'scheduled_job_failed' || notification.kind === 'sync_failed') return '/admin/oracle-monitoring';
  if (typeof payload.taskId === 'string' && payload.taskId) {
    return typeof payload.customerId === 'string' && payload.customerId
      ? `/customers/${payload.customerId}?tab=overview&complete=${payload.taskId}`
      : `/tasks?taskId=${payload.taskId}`;
  }
  if (typeof payload.customerId === 'string' && payload.customerId) {
    const tab = notification.kind.includes('promise')
      ? 'promises'
      : notification.kind.includes('collection') || notification.kind === 'receipt_uploaded'
        ? 'collections'
        : 'overview';
    return `/customers/${payload.customerId}?tab=${tab}`;
  }
  if (notification.kind === 'task_new') return '/tasks';
  return '/notifications';
}
