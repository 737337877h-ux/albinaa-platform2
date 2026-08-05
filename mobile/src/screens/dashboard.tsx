import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useAuth } from '../store/auth-context';
import { getAll } from '../db/database';
import { useFocusEffect } from '@react-navigation/native';
import { useSync } from '../store/sync-context';

export default function DashboardScreen({ navigation }: any) {
  const { user } = useAuth();
  const { status, triggerSync } = useSync();
  const [localTasks, setLocalTasks] = React.useState<any[]>([]);
  const [localCollections, setLocalCollections] = React.useState<any[]>([]);
  const [localCustomers, setLocalCustomers] = React.useState<any[]>([]);
  const [localFollowups, setLocalFollowups] = React.useState<any[]>([]);

  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        const today = localDateKey(new Date());
        const [tasks, collections, customers, followups] = await Promise.all([
          getAll('tasks'),
          getAll('collections'),
          getAll('customers'),
          getAll('followups'),
        ]);
        setLocalTasks(tasks);
        setLocalCollections(collections.filter((c: any) => c.collectedAt && localDateKey(new Date(c.collectedAt)) === today));
        setLocalCustomers(customers);
        setLocalFollowups(followups.filter((f: any) => f.followupAt && localDateKey(new Date(f.followupAt)) === today));
      })();
    }, []),
  );

  // Count unique customers by id to avoid duplicates
  const uniqueCustomerCount = new Set(localCustomers.map((c: any) => c.id)).size;

  const tasks = localTasks;
  const todayTasks = tasks.filter((t: any) => {
    if (!t.dueDate) return false;
    const today = localDateKey(new Date());
    return t.dueDate.split('T')[0] === today;
  });

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={status.phase === 'syncing'} onRefresh={triggerSync} tintColor="#0A604D" />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>البناء الراقي تحصيل</Text>
          <Text style={styles.greeting}>مرحباً، {user?.fullName}</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.syncChip}>
          <Text style={styles.syncChipText}>
            {status.phase === 'synced' ? '✓ متزامن' : status.phase === 'syncing' ? '↻ مزامنة' : '○ دون اتصال'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.cardsRow}>
        <Card title="مهام اليوم" value={todayTasks.length} color="#1a73e8" onPress={() => navigation.navigate('Tasks')} />
        <Card title="تحصيلات اليوم" value={localCollections.length} color="#34a853" onPress={() => navigation.navigate('CollectionsList')} />
      </View>
      <View style={styles.cardsRow}>
        <Card title="العملاء" value={uniqueCustomerCount} color="#fbbc04" onPress={() => navigation.navigate('Customers')} />
        <Card title="المتابعات" value={localFollowups.length} color="#ea4335" onPress={() => navigation.navigate('FollowupsList')} />
      </View>

      <Text style={styles.sectionTitle}>مهام اليوم</Text>
      {todayTasks.length === 0 ? (
        <Text style={styles.emptyText}>لا توجد مهام لليوم</Text>
      ) : (
        todayTasks.slice(0, 5).map((t: any, i: number) => (
          <TouchableOpacity key={t.id || i} style={styles.taskItem} onPress={() => navigation.navigate('Customer360', { id: t.customerId })}>
            <Text style={styles.taskTitle}>{t.customer?.name || t.customerName || 'عميل'}</Text>
            <Text style={styles.taskDate}>{t.dueDate ? new Date(t.dueDate).toLocaleDateString('ar-SA') : ''}</Text>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function Card({ title, value, color, onPress }: { title: string; value: number; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.card, { borderLeftColor: color }]} onPress={onPress}>
      <Text style={[styles.cardValue, { color }]}>{value}</Text>
      <Text style={styles.cardTitle}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F6F4' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 28, backgroundColor: '#0A4A3C' },
  brand: { fontSize: 13, color: '#F7A928', fontWeight: '800', marginBottom: 5 },
  greeting: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  syncChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)' },
  syncChipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  cardsRow: { flexDirection: 'row', padding: 10, gap: 10 },
  card: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 16, borderLeftWidth: 4, borderWidth: 1, borderColor: '#E0E9E5', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  cardValue: { fontSize: 32, fontWeight: 'bold' },
  cardTitle: { fontSize: 14, color: '#666', marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#333', padding: 20, paddingBottom: 10 },
  emptyText: { textAlign: 'center', color: '#999', padding: 20 },
  taskItem: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 10, flexDirection: 'row', justifyContent: 'space-between' },
  taskTitle: { fontSize: 16, color: '#333' },
  taskDate: { fontSize: 14, color: '#999' },
});
