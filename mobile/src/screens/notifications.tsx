import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '../api/endpoints';
import Loading from '../components/loading';

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
  customer_transferred: 'إسناد عميل',
  cash_receive: 'تحصيل نقدي',
  task_new: 'مهمة جديدة',
  receipt_uploaded: 'رفع سند',
  sync_failed: 'فشل مزامنة',
};

function extractNotifications(payload: NotificationsResponse | NotificationItem[] | undefined): NotificationItem[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.items ?? [];
}

function formatTitle(item: NotificationItem): string {
  const kind = KIND_LABELS[item.kind] || item.kind || 'إشعار';
  const p = item.payload || {};
  if (p.amount && p.currency) {
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
  if (p.amount && p.currency) parts.push(`المبلغ: ${p.amount} ${p.currency}`);
  if (p.dueDate) parts.push(`تاريخ الاستحقاق: ${new Date(p.dueDate).toLocaleDateString('ar-SA')}`);
  if (p.collectorName) parts.push(`المحصل: ${p.collectorName}`);
  if (p.method) parts.push(`الطريقة: ${p.method}`);
  if (p.notes) parts.push(p.notes);
  if (parts.length === 0 && item.kind) {
    parts.push(`نوع الحدث: ${item.kind}`);
  }
  return parts.join('\n');
}

export default function NotificationsScreen() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<NotificationItem[]>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await fetchNotifications();
      return extractNotifications(res.data);
    },
  });

  const readMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const readAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

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
            onPress={() => { if (!item.readAt) readMutation.mutate(item.id); }}
          >
            <View style={styles.itemHeader}>
              <Text style={styles.kind}>{KIND_LABELS[item.kind] || item.kind}</Text>
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
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  headerText: { fontSize: 14, color: '#666' },
  readAllText: { color: '#1a73e8', fontSize: 14, fontWeight: '600' },
  item: { backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 8, padding: 14, borderRadius: 10 },
  unread: { borderLeftWidth: 3, borderLeftColor: '#1a73e8' },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  kind: { fontSize: 11, color: '#1a73e8', fontWeight: '600' },
  readState: { fontSize: 11, color: '#999' },
  title: { fontSize: 15, fontWeight: '600', color: '#333' },
  body: { fontSize: 13, color: '#555', marginTop: 6, lineHeight: 18 },
  date: { fontSize: 11, color: '#999', marginTop: 6 },
  empty: { textAlign: 'center', color: '#999', padding: 40 },
});
