import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { getAll } from '../db/database';
import { useFocusEffect } from '@react-navigation/native';
import { useSync } from '../store/sync-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow } from '../theme';
import { displayDateFromIso, taskLabel } from '../utils/date-input';

export default function TasksScreen({ navigation }: any) {
  const [localTasks, setLocalTasks] = React.useState<any[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const { triggerSync } = useSync();

  useFocusEffect(
    React.useCallback(() => {
      (async () => { setLocalTasks(await getAll('tasks')); })();
    }, []),
  );

  const query = search.trim().toLowerCase();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const tasks = localTasks.filter((item) => {
    if (!['open', 'pending', '', null, undefined].includes(item.status)) return false;
    if (item.dueDate && String(item.dueDate).slice(0, 10) > today) return false;
    if (!query) return true;
    return [item.customer?.name, item.customerName, item.title, item.priorityReason, item.taskType]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  const renderTask = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.taskItem}
      onPress={() => item.customerId && navigation.navigate('Customer360', { id: item.customerId })}
    >
      <View style={styles.taskIcon}><Ionicons name={String(item.taskType).toLowerCase() === 'visit' ? 'location-outline' : 'call-outline'} size={21} color={colors.gold} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.taskName}>{item.customer?.name || item.customerName || 'عميل'}</Text>
        {!!item.priorityReason && <Text style={styles.taskReason}>{item.priorityReason}</Text>}
        {item.expectedAmount && (
          <Text style={styles.taskAmount}>
            {item.expectedAmount} {item.expectedCurrency}
          </Text>
        )}
      </View>
      <View style={styles.taskSide}>
        <Text style={styles.taskDue}>
          {item.dueDate ? displayDateFromIso(String(item.dueDate).slice(0, 10)) : ''}
        </Text>
        <Text style={styles.taskType}>{taskLabel(item.taskType || item.priority)}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>الراقي</Text><Text style={styles.title}>المهام</Text>
          <Text style={styles.subtitle}>الإجمالي: {tasks.length}</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('NewTask')}>
          <Ionicons name="add" size={17} color={colors.primary} /><Text style={styles.addBtnText}>مهمة</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={20} color={colors.muted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="ابحث باسم العميل أو سبب المهمة..."
          placeholderTextColor={colors.muted}
          textAlign="right"
          returnKeyType="search"
        />
        {!!search && <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={20} color={colors.muted} /></TouchableOpacity>}
      </View>
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
            await triggerSync();
            setLocalTasks(await getAll('tasks'));
            setRefreshing(false);
          }}
        />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', padding: 18, backgroundColor: colors.primary },
  eyebrow: { fontSize: 11, fontWeight: '900', color: colors.gold, textAlign: 'right' },
  title: { fontSize: 23, fontWeight: '900', color: '#fff', textAlign: 'right' },
  subtitle: { fontSize: 12, color: '#B9CCC7', marginTop: 4, textAlign: 'right' },
  addBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, backgroundColor: colors.gold, paddingHorizontal: 13, paddingVertical: 10, borderRadius: radius.pill },
  addBtnText: { color: colors.primary, fontWeight: '900' },
  searchWrap: { marginHorizontal: 14, marginTop: 12, paddingHorizontal: 13, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, flexDirection: 'row-reverse', alignItems: 'center', gap: 8, ...shadow },
  searchInput: { flex: 1, color: colors.ink, fontSize: 14, paddingVertical: 10 },
  taskItem: { backgroundColor: colors.surface, marginHorizontal: 14, marginTop: 10, padding: 14, borderRadius: radius.md, flexDirection: 'row-reverse', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.line, ...shadow },
  taskIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' },
  taskName: { fontSize: 15, color: colors.ink, fontWeight: '800', textAlign: 'right' },
  taskReason: { fontSize: 12, color: colors.muted, marginTop: 4, textAlign: 'right' },
  taskAmount: { fontSize: 13, color: colors.danger, marginTop: 5, fontWeight: '900', textAlign: 'right' },
  taskSide: { alignItems: 'flex-start', minWidth: 68 },
  taskDue: { fontSize: 11, color: colors.muted },
  taskType: { fontSize: 11, color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 7, paddingVertical: 4, borderRadius: radius.pill, marginTop: 5, fontWeight: '800' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: colors.primary, fontSize: 16, fontWeight: '700', textAlign: 'center', padding: 20 },
});
