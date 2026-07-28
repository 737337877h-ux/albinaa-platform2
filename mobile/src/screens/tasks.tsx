import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchSync } from '../api/endpoints';
import { getMeta, getAll } from '../db/database';
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

  const { data, isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      const token = await getMeta('syncToken');
      const res = await fetchSync(token || undefined);
      return res.data.tasks;
    },
  });

  const tasks = data || localTasks;

  const renderTask = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.taskItem}
      onPress={() => navigation.navigate('Customer360', { id: item.customerId })}
    >
      <Text style={styles.taskName}>{item.customer?.name || item.customerName || 'عميل'}</Text>
      <Text style={styles.taskDue}>{item.dueDate ? new Date(item.dueDate).toLocaleDateString('ar-SA') : ''}</Text>
    </TouchableOpacity>
  );

  if (isLoading && tasks.length === 0) return <Loading />;

  return (
    <View style={styles.container}>
      <FlatList
        data={tasks}
        keyExtractor={(_, i) => String(i)}
        renderItem={renderTask}
        contentContainerStyle={tasks.length === 0 ? styles.empty : undefined}
        ListEmptyComponent={<Text style={styles.emptyText}>لا توجد مهام</Text>}
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          setLocalTasks(await getAll('tasks'));
          setRefreshing(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  taskItem: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 10, padding: 16, borderRadius: 10, flexDirection: 'row', justifyContent: 'space-between' },
  taskName: { fontSize: 16, color: '#333' },
  taskDue: { fontSize: 14, color: '#999' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#999', fontSize: 16 },
});
