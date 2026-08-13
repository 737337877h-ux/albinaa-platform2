import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '../api/endpoints';
import Loading from '../components/loading';
import { colors, radius, shadow } from '../theme';

export interface NotificationItem {
  id: string;
  kind: string;
  payload: Record<string, any>;
  createdAt: string;
  readAt?: string | null;
}

interface NotificationsResponse {
  items?: NotificationItem[];
  total?: number;
  unread?: number;
}

const KIND_LABELS: Record<string, string> = {
  followup_due: 'متابعة مستحقة',
  promise_due: 'وعد سداد مستحق',
  promise_overdue: 'وعد سداد متأخر',
  collection_created: 'تحصيل جديد',
  collection_reversal_requested: 'طلب عكس تحصيل',
  customer_transferred: 'إسناد عميل',
  assignment_change_requested: 'طلب تغيير إسناد',
  assignment_change_reviewed: 'نتيجة طلب تغيير الإسناد',
  finance_alert: 'تنبيه مالي مهم',
  cash_receive: 'تحصيل نقدي',
  task_new: 'مهمة جديدة',
  receipt_uploaded: 'رفع سند',
  sync_failed: 'فشل مزامنة',
};

const EVENT_LABELS: Record<string, string> = {
  collection_reversed: 'عكس تحصيل',
  manual_balance_adjustment: 'تعديل يدوي للرصيد',
  credit_limit_overridden: 'تجاوز سقف الائتمان',
  customer_merged: 'دمج حساب عميل',
  import_reversed: 'عكس استيراد',
};

function kindLabel(item: NotificationItem): string {
  if (item.kind === 'assignment_change_reviewed') {
    if (item.payload?.decision === 'approved') return 'تم اعتماد تغيير الإسناد';
    if (item.payload?.decision === 'rejected') return 'تم رفض تغيير الإسناد';
  }
  return KIND_LABELS[item.kind] || 'إشعار نظام';
}

function extractNotifications(payload: NotificationsResponse | NotificationItem[] | undefined): NotificationItem[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.items ?? [];
}

function formatTitle(item: NotificationItem): string {
  const kind = kindLabel(item);
  const p = item.payload || {};
  if (p.amount != null && p.currency) {
    return `${kind} — ${p.amount} ${p.currency}`;
  }
  if (p.customerName) {
    return `${kind} — ${p.customerName}`;
  }
  return kind;
}

function formatBody(item: NotificationItem): string {
  const p = item.payload || {};
  const parts: string[] = [];
  if (p.customerName) parts.push(`العميل: ${p.customerName}`);
  if (p.amount != null && p.currency) parts.push(`المبلغ: ${p.amount} ${p.currency}`);
  if (p.dueDate) parts.push(`تاريخ الاستحقاق: ${new Date(p.dueDate).toLocaleDateString('ar-SA')}`);
  if (p.collectorName) parts.push(`المحصل: ${p.collectorName}`);
  if (p.requesterName) parts.push(`مقدم الطلب: ${p.requesterName}`);
  if (p.method) parts.push(`الطريقة: ${p.method}`);
  if (p.event) parts.push(`الإجراء: ${EVENT_LABELS[p.event] || 'إجراء مالي'}`);
  if (p.reason) parts.push(`السبب: ${p.reason}`);
  if (p.note) parts.push(`ملاحظة المراجع: ${p.note}`);
  if (p.notes) parts.push(p.notes);
  if (parts.length === 0) {
    parts.push('يوجد تحديث جديد في النظام.');
  }
  return parts.join('\n');
}

function getNavigationTarget(item: NotificationItem): { route: string; params: Record<string, any> } | null {
  const p = item.payload || {};
  switch (item.kind) {
    case 'followup_due':
    case 'promise_due':
    case 'promise_overdue':
    case 'customer_transferred':
    case 'collection_created':
      if (p.customerId) return { route: 'Customer360', params: { id: p.customerId } };
      return null;
    case 'task_new':
      return { route: 'Tasks', params: {} };
    default:
      return null;
  }
}

export default function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<NotificationItem[]>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await fetchNotifications();
      return extractNotifications(res.data);
    },
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

  const readMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const readAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['notifications'] });
    },
  });

  function handlePress(item: NotificationItem) {
    if (!item.readAt) readMutation.mutate(item.id);
    const target = getNavigationTarget(item);
    if (target) {
      navigation.navigate(target.route, target.params);
    } else {
      navigation.navigate('Dashboard');
    }
  }

  if (isLoading) return <Loading />;

  const notifications: NotificationItem[] = data ?? [];
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>
          {notifications.length} إشعار — {unreadCount} غير مقروء
        </Text>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={() => readAllMutation.mutate()}>
            <Text style={styles.readAllText}>تحديد الكل كمقروء</Text>
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={notifications}
        keyExtractor={(item: NotificationItem) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.item, !item.readAt && styles.unread]}
            onPress={() => handlePress(item)}
          >
            <View style={styles.itemHeader}>
              <Text style={styles.kind}>{kindLabel(item)}</Text>
              <Text style={styles.readState}>{item.readAt ? '✓ مقروء' : '● جديد'}</Text>
            </View>
            <Text style={styles.title}>{formatTitle(item)}</Text>
            <Text style={styles.body}>{formatBody(item)}</Text>
            <Text style={styles.date}>{new Date(item.createdAt).toLocaleString('ar-SA')}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>لا توجد إشعارات</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', padding: 14, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line },
  headerText: { fontSize: 14, color: colors.muted, textAlign: 'right' },
  readAllText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  item: { backgroundColor: colors.surface, marginHorizontal: 12, marginBottom: 8, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, ...shadow },
  unread: { borderRightWidth: 4, borderRightColor: colors.gold },
  itemHeader: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 4 },
  kind: { fontSize: 11, color: colors.primary, backgroundColor: colors.goldSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, fontWeight: '800' },
  readState: { fontSize: 11, color: colors.muted },
  title: { fontSize: 15, fontWeight: '800', color: colors.primary, textAlign: 'right' },
  body: { fontSize: 13, color: colors.ink, marginTop: 6, lineHeight: 20, textAlign: 'right' },
  date: { fontSize: 11, color: colors.muted, marginTop: 6, textAlign: 'right' },
  empty: { textAlign: 'center', color: colors.muted, padding: 40 },
});
