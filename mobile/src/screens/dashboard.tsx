import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useAuth } from '../store/auth-context';
import { useQuery } from '@tanstack/react-query';
import { fetchSync } from '../api/endpoints';
import { getAll, getMeta } from '../db/database';
import { useFocusEffect } from '@react-navigation/native';
import Loading from '../components/loading';

export default function DashboardScreen({ navigation }: any) {
  const { user, logout } = useAuth();
  const [localTasks, setLocalTasks] = React.useState<any[]>([]);
  const [localCollections, setLocalCollections] = React.useState<any[]>([]);

  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        setLocalTasks(await getAll('tasks'));
        setLocalCollections(await getAll('collections'));
      })();
    }, []),
  );

  const { data: syncData, isLoading } = useQuery({
    queryKey: ['sync'],
    queryFn: async () => {
      const token = await getMeta('syncToken');
      const res = await fetchSync(token || undefined);
      return res.data;
    },
    refetchInterval: 30_000,
  });

  if (isLoading && !syncData) return <Loading />;

  const tasks = syncData?.tasks || localTasks || [];
  const todayTasks = tasks.filter((t: any) => {
    if (!t.dueDate) return false;
    const today = new Date().toISOString().split('T')[0];
    return t.dueDate.split('T')[0] === today;
  });

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>مرحباً، {user?.fullName}</Text>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>تسجيل خروج</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.cardsRow}>
        <Card title="مهام اليوم" value={todayTasks.length} color="#1a73e8" onPress={() => navigation.navigate('Tasks')} />
        <Card title="تحصيلات اليوم" value={localCollections.length} color="#34a853" onPress={() => navigation.navigate('NewCollection')} />
      </View>
      <View style={styles.cardsRow}>
        <Card title="العملاء" value={syncData?.customers?.length || 0} color="#fbbc04" onPress={() => navigation.navigate('Customers')} />
        <Card title="المتابعات" value={syncData?.followups?.length || 0} color="#ea4335" onPress={() => navigation.navigate('NewFollowup')} />
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

function Card({ title, value, color, onPress }: { title: string; value: number; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.card, { borderLeftColor: color }]} onPress={onPress}>
      <Text style={[styles.cardValue, { color }]}>{value}</Text>
      <Text style={styles.cardTitle}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: '#1a73e8' },
  greeting: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  logoutBtn: { padding: 8 },
  logoutText: { color: '#fff', fontSize: 14 },
  cardsRow: { flexDirection: 'row', padding: 10, gap: 10 },
  card: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 16, borderLeftWidth: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  cardValue: { fontSize: 32, fontWeight: 'bold' },
  cardTitle: { fontSize: 14, color: '#666', marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#333', padding: 20, paddingBottom: 10 },
  emptyText: { textAlign: 'center', color: '#999', padding: 20 },
  taskItem: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 10, flexDirection: 'row', justifyContent: 'space-between' },
  taskTitle: { fontSize: 16, color: '#333' },
  taskDate: { fontSize: 14, color: '#999' },
});
