import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchSync, fetchTasks } from '../api/endpoints';
import { getAll } from '../db/database';
import { useFocusEffect } from '@react-navigation/native';
import Loading from '../components/loading';

export default function TasksScreen({ navigation }: any) {
  const [localTasks, setLocalTasks] = React.useState<any[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);

  useFocusEffect(
    React.useCallback(() => {
      (async () => { setLocalTasks(await getAll('tasks')); })();
    }, []),
  );

  // Use /tasks endpoint directly for guaranteed up-to-date results
  const { data: remoteTasks, isLoading, refetch } = useQuery({
    queryKey: ['tasks-list'],
    queryFn: () => fetchTasks().then((r) => r.data),
    refetchOnMount: 'always',
  });

  // Also get tasks from sync (local) as fallback
  const { data: syncData } = useQuery({
    queryKey: ['sync'],
    queryFn: () => fetchSync(undefined).then((r) => r.data),
  });

  // Dedupe by id and merge
  const seen = new Set<string>();
  const tasks: any[] = [];
  for (const t of [...(remoteTasks || []), ...(syncData?.tasks || []), ...localTasks]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    tasks.push(t);
  }

  const renderTask = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.taskItem}
      onPress={() => item.customerId && navigation.navigate('Customer360', { id: item.customerId })}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.taskName}>{item.customer?.name || item.customerName || 'عميل'}</Text>
        {!!item.priorityReason && <Text style={styles.taskReason}>{item.priorityReason}</Text>}
        {item.expectedAmount && (
          <Text style={styles.taskAmount}>
            {item.expectedAmount} {item.expectedCurrency}
          </Text>
        )}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.taskDue}>
          {item.dueDate ? new Date(item.dueDate).toLocaleDateString('ar-SA') : ''}
        </Text>
        <Text style={styles.taskType}>{item.taskType || item.priority || ''}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>المهام</Text>
          <Text style={styles.subtitle}>الإجمالي: {tasks.length}</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('NewTask')}>
          <Text style={styles.addBtnText}>+ مهمة</Text>
        </TouchableOpacity>
      </View>
      {isLoading && tasks.length === 0 ? <Loading /> : (
        <FlatList
          data={tasks}
          keyExtractor={(item) => item.id}
          renderItem={renderTask}
          contentContainerStyle={tasks.length === 0 ? styles.empty : undefined}
          ListEmptyComponent={
            <TouchableOpacity onPress={() => navigation.navigate('NewTask')}>
              <Text style={styles.emptyText}>لا توجد مهام — اضغط هنا لإنشاء مهمة</Text>
            </TouchableOpacity>
          }
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await refetch();
            setLocalTasks(await getAll('tasks'));
            setRefreshing(false);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#1a73e8' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 12, color: '#fff', marginTop: 4, opacity: 0.9 },
  addBtn: { backgroundColor: 'rgba(255,255,255,0.2)', padding: 10, borderRadius: 8 },
  addBtnText: { color: '#fff', fontWeight: '600' },
  taskItem: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 10, padding: 16, borderRadius: 10, flexDirection: 'row', justifyContent: 'space-between' },
  taskName: { fontSize: 16, color: '#333', fontWeight: '500' },
  taskReason: { fontSize: 13, color: '#666', marginTop: 4 },
  taskAmount: { fontSize: 13, color: '#34a853', marginTop: 4, fontWeight: '600' },
  taskDue: { fontSize: 14, color: '#999' },
  taskType: { fontSize: 11, color: '#1a73e8', marginTop: 4, fontWeight: '600' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#1a73e8', fontSize: 16, textAlign: 'center', padding: 20 },
});
