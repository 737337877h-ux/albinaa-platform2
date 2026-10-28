import React from 'react';
import { isOperationsApp } from '../config/product';
import { isOperationsNotification } from '../utils/operations-access';
import {canOpenAppRoute} from '../utils/app-access';
import {useAuth} from '../store/auth-context';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '../api/endpoints';
import Loading from '../components/loading';
import { colors, radius, shadow } from '../theme';
import { notificationNavigationTarget } from '../utils/notification-navigation';

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
  task_overdue: 'إعادة تصعيد مهمة متأخرة',
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
  if (item.payload?.diagnostic === true) return String(item.payload.title ?? 'إشعار اختبار');
  if((item.kind.startsWith('hr_request_')||item.kind.startsWith('hr_task_')))return String(item.payload?.title??'طلب موظف');
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
  if (p.diagnostic === true) return String(p.message ?? 'إشعار اختبار فقط');
  if((item.kind.startsWith('hr_request_')||item.kind.startsWith('hr_task_')))return String(p.message??'راجع الطلب');
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
  return notificationNavigationTarget(item.kind, item.payload || {});
}

export default function NotificationsScreen() {
  const permissions = useAuth().user?.permissions ?? [];
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useQuery<NotificationItem[]>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await fetchNotifications();
      return extractNotifications(res.data).filter(n => !isOperationsApp || isOperationsNotification(n.kind));
    },
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });
  useFocusEffect(React.useCallback(() => { void refetch(); }, [refetch]));

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
    if (target && canOpenAppRoute(target.route,permissions)) {
      navigation.navigate(target.route, target.params);
    } else {
      navigation.navigate('Main');
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
  headerText: { fontFamily: 'TajawalRegular', fontSize: 15, color: colors.muted, textAlign: 'right' },
  readAllText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 15, fontWeight: '800' },
  item: { backgroundColor: colors.surface, marginHorizontal: 12, marginBottom: 8, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, ...shadow },
  unread: { borderRightWidth: 4, borderRightColor: colors.gold },
  itemHeader: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 4 },
  kind: { fontFamily: 'TajawalBold', fontSize: 13, color: colors.primary, backgroundColor: colors.goldSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, fontWeight: '800' },
  readState: { fontFamily: 'TajawalRegular', fontSize: 13, color: colors.muted },
  title: { fontFamily: 'TajawalBold', fontSize: 16, fontWeight: '800', color: colors.primary, textAlign: 'right' },
  body: { fontFamily: 'TajawalRegular', fontSize: 14, color: colors.ink, marginTop: 6, lineHeight: 20, textAlign: 'right' },
  date: { fontFamily: 'TajawalRegular', fontSize: 13, color: colors.muted, marginTop: 6, textAlign: 'right' },
  empty: { textAlign: 'center', color: colors.muted, padding: 40 },
});
