import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getAll, getMutationQueueStats } from '../db/database';

const CHANNEL_ID = 'albinaa-reminders';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface ReminderPlanItem {
  id: string;
  title: string;
  body: string;
  at: Date;
  data?: Record<string, unknown>;
}

function dateOnlyAtLocalHour(value: string, hour = 9): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Pure planner kept separate from the device scheduler for deterministic tests. */
export function buildReminderPlan(
  tasks: any[],
  promises: any[],
  now = new Date(),
  blockedMutations = 0,
): ReminderPlanItem[] {
  const plan: ReminderPlanItem[] = [];
  const soon = new Date(now.getTime() + 10_000);
  const overdueTasks = tasks.filter((task) => {
    const due = dateOnlyAtLocalHour(task.dueDate, 9);
    return task.status !== 'completed' && due && due.getTime() < now.getTime();
  });

  if (overdueTasks.length > 0) {
    plan.push({
      id: 'overdue-tasks',
      title: 'مهام تحصيل متأخرة',
      body: `لديك ${overdueTasks.length} مهمة تحتاج إلى متابعة الآن.`,
      at: soon,
      data: { route: 'Tasks' },
    });
  }

  const futureTasks = tasks
    .map((task) => ({ task, at: dateOnlyAtLocalHour(task.dueDate, 9) }))
    .filter((entry) => entry.task.status !== 'completed' && entry.at && entry.at.getTime() >= now.getTime())
    .sort((a, b) => a.at!.getTime() - b.at!.getTime())
    .slice(0, 25);
  for (const { task, at } of futureTasks) {
    plan.push({
      id: `task:${task.id}`,
      title: 'تذكير بمهمة تحصيل',
      body: task.customerName ? `متابعة ${task.customerName}` : (task.title || 'لديك مهمة مستحقة'),
      at: at!,
      data: { route: 'Customer360', customerId: task.customerId },
    });
  }

  const duePromises = promises
    .filter((promise) => !['fulfilled', 'cancelled'].includes(promise.status))
    .map((promise) => ({ promise, at: dateOnlyAtLocalHour(promise.dueDate, 8) }))
    .filter((entry) => entry.at && entry.at.getTime() >= now.getTime())
    .sort((a, b) => a.at!.getTime() - b.at!.getTime())
    .slice(0, 25);
  for (const { promise, at } of duePromises) {
    plan.push({
      id: `promise:${promise.id}`,
      title: 'وعد سداد مستحق',
      body: `${promise.customerName || 'عميل'} — ${Number(promise.expectedAmount || 0).toLocaleString('en-US')} ${promise.currencyCode || ''}`,
      at: at!,
      data: { route: 'Customer360', customerId: promise.customerId },
    });
  }

  if (blockedMutations > 0) {
    plan.push({
      id: 'blocked-sync',
      title: 'عمليات تحتاج إلى مراجعة',
      body: `توجد ${blockedMutations} عملية لم يقبلها الخادم. افتح حالة المزامنة لمراجعتها.`,
      at: new Date(now.getTime() + 20_000),
      data: { route: 'Settings' },
    });
  }
  return plan;
}

export async function initializeLocalNotifications(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'تنبيهات التحصيل والمهام',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0A4A3C',
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function areLocalNotificationsEnabled(): Promise<boolean> {
  const permission = await Notifications.getPermissionsAsync();
  return permission.granted;
}

export async function disableLocalNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.setBadgeCountAsync(0);
}

export async function rescheduleOfflineReminders(): Promise<number> {
  const enabled = await initializeLocalNotifications();
  if (!enabled) return 0;
  const [tasks, promises, queue] = await Promise.all([
    getAll('tasks'),
    getAll('promises'),
    getMutationQueueStats(),
  ]);
  const plan = buildReminderPlan(tasks, promises, new Date(), queue.blocked);
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const item of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: item.id,
      content: {
        title: item.title,
        body: item.body,
        data: item.data || {},
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: item.at,
        channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
      },
    });
  }
  return plan.length;
}
