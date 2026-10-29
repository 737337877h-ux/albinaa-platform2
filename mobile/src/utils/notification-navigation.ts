export interface NotificationNavigationTarget {
  route: string;
  params: Record<string, any>;
}

export function notificationNavigationTarget(kind: string, payload: Record<string, any> = {}): NotificationNavigationTarget {
  if (kind === 'task_new' || payload.taskId) return { route: 'Main', params: { screen: 'Tasks', params: { taskId: payload.taskId } } };
  if (payload.customerId) return { route: 'Customer360', params: { id: payload.customerId } };
  if (kind.includes('collection') || kind === 'receipt_uploaded') return { route: 'CollectionsList', params: {} };
  if (kind.includes('promise')) return { route: 'PromisesList', params: {} };
  if (kind === 'followup_due') return { route: 'FollowupsList', params: {} };
  if (kind === 'sync_failed' || kind === 'scheduled_job_failed') return { route: 'Settings', params: {} };
  return { route: 'Notifications', params: {} };
}
