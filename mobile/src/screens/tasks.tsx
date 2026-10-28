import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { getAll } from '../db/database';
import { useFocusEffect } from '@react-navigation/native';
import { useSync } from '../store/sync-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow } from '../theme';
import { displayDateFromIso, taskLabel } from '../utils/date-input';
import { collapseTasksByCustomer, taskDateKey, isDailyPriority, todayTaskViews } from '../utils/tasks';
import { useAuth } from '../store/auth-context';
import { canUseMobileFeature } from '../utils/mobile-permissions';
import {customerEngagementIds, hasNoRecordedFollowup, totalActionableDebtorBalance} from '../utils/customer';

type TaskFilter = 'today' | 'scheduled' | 'overdue' | 'never_followed';
const taskFilter = (value: unknown): TaskFilter => value === 'stored' || value === 'scheduled' ? 'scheduled' : value === 'overdue' ? 'overdue' : value === 'never_followed' ? 'never_followed' : 'today';

const FILTER_LABELS: Record<TaskFilter, string> = {
  today: 'عمل اليوم', scheduled: 'المجدولة', overdue: 'متأخرة', never_followed: 'دون متابعة',
};

export default function TasksScreen({ navigation, route }: any) {
  const [localTasks, setLocalTasks] = React.useState<any[]>([]);
  const [unfollowedAccounts, setUnfollowedAccounts] = React.useState<any[]>([]);
  const load = React.useCallback(async () => {
    const [tasks, accounts, followups] = await Promise.all([getAll('tasks'), getAll('customers'), getAll('followups')]);
    const ids = customerEngagementIds(followups.filter((f:any) => !f.deletedAt));
    setLocalTasks(tasks.map(t=>({...t,taskType:t.taskType||t.priority,priorityReason:t.priorityReason||t.title})));
    setUnfollowedAccounts(accounts.filter((a:any) => a.customerType !== 'advance' && a.assignedCollectorName
      && totalActionableDebtorBalance(a.balances) > 0 && hasNoRecordedFollowup(a, ids)));
  }, []);
  const [refreshing, setRefreshing] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [todayView,setTodayView] = React.useState<'all'|'manual'|'automatic'>('manual');
  const [filter, setFilter] = React.useState<TaskFilter>(taskFilter(route?.params?.initialFilter));
  const { triggerSync, status } = useSync();
  const { user } = useAuth();
  const canCreate = canUseMobileFeature(user?.permissions, 'mobile.tasks.create', 'tasks.manage');
  const focusedTaskId = route?.params?.taskId ? String(route.params.taskId) : null;

  React.useEffect(() => {
    const requested = route?.params?.initialFilter;
    if (requested && ['today', 'scheduled', 'overdue', 'stored', 'never_followed'].includes(requested)) setFilter(taskFilter(requested));
  }, [route?.params?.initialFilter]);

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load]),
  );

  React.useEffect(() => {
    if (status.phase === 'synced' && status.lastSyncAt) {
      load().catch(() => undefined);
    }
  }, [load, status.lastSyncAt, status.phase]);

  const query = search.trim().toLowerCase();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayGroups = todayTaskViews(localTasks,today,focusedTaskId);
  React.useEffect(()=>{if(focusedTaskId && todayGroups.all.some(t=>t.id===focusedTaskId))setTodayView('all');},[focusedTaskId,localTasks]);
  const tasks = filter === 'never_followed' ? unfollowedAccounts
    .filter((a) => !query || [a.fullName,a.name,a.accountNumber,a.externalCustomerCode].some(v=>String(v??'').toLowerCase().includes(query)))
    .map((a) => ({id:`unfollowed:${a.id}`,customerId:a.id,customerName:a.fullName||a.name,priorityReason:'لم تُسجّل أي متابعة لهذا الحساب',neverFollowed:true}))
    : filter === 'today' ? todayGroups[todayView].filter(item=>!query || [item.customer?.name,item.customerName,item.title,item.priorityReason,item.manualReason,item.automaticReason,item.taskType].some(v=>String(v??'').toLowerCase().includes(query)))
    : collapseTasksByCustomer(localTasks.filter((item) => {
    if (!['open', 'pending', '', null, undefined].includes(item.status)) return false;
    const due = taskDateKey(item.dueDate);
    if (filter === 'scheduled' && (!due || due <= today)) return false;
    if ((filter === 'overdue' || filter === 'scheduled') && isDailyPriority(item.taskType)) return false;
    if (filter === 'overdue' && (!due || due >= today)) return false;
    if (!query) return true;
    return [item.customer?.name, item.customerName, item.title, item.priorityReason, item.taskType]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  }), focusedTaskId).sort((a, b) => Number(String(b.id) === focusedTaskId) - Number(String(a.id) === focusedTaskId));

  const renderTask = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={[styles.taskItem, String(item.id) === focusedTaskId && styles.focusedTask]}
      onPress={() => item.customerId && navigation.navigate('Customer360', { id: item.customerId })}
    >
      <View style={styles.taskIcon}><Ionicons name={String(item.taskType).toLowerCase() === 'visit' ? 'location-outline' : 'call-outline'} size={21} color={colors.gold} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.taskName}>{item.customer?.name || item.customerName || 'عميل'}</Text>
        {filter==='today' && <View style={styles.badges}>
          {item.hasManual && <Text style={styles.manualBadge}>موعد مسجّل</Text>}
          {item.hasAutomatic && <Text style={styles.automaticBadge}>أولوية تلقائية</Text>}
        </View>}
        {!!item.priorityReason && <Text style={styles.taskReason}>{item.priorityReason}</Text>}
        {filter==='today' && item.manualReason && item.manualReason!==item.priorityReason && <Text style={styles.taskReason}>الموعد: {item.manualReason}</Text>}
        {filter==='today' && item.automaticReason && item.automaticReason!==item.priorityReason && <Text style={styles.taskReason}>الأولوية: {item.automaticReason}</Text>}
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
        <Text style={styles.taskType}>{item.neverFollowed ? 'دون متابعة' : taskLabel(item.taskType || item.priority)}</Text>
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
        {canCreate && <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('NewTask')}>
          <Ionicons name="add" size={17} color={colors.primary} /><Text style={styles.addBtnText}>مهمة</Text>
        </TouchableOpacity>}
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
      <View style={styles.filters}>
        {(Object.keys(FILTER_LABELS) as TaskFilter[]).map((value) => (
          <TouchableOpacity
            key={value}
            style={[styles.filterButton, filter === value && styles.filterButtonActive]}
            onPress={() => {setFilter(value);if(value==='today')setTodayView('manual');}}
          >
            <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{FILTER_LABELS[value]}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {filter==='today' && <View style={styles.filters}>
        {([{id:'all',label:'الكل'},{id:'manual',label:'مواعيد اليوم'},{id:'automatic',label:'أولويات تلقائية'}] as const).map(v=><TouchableOpacity key={v.id} accessibilityRole="button" accessibilityState={{selected:todayView===v.id}} style={[styles.filterButton,todayView===v.id&&styles.filterButtonActive]} onPress={()=>setTodayView(v.id)}><Text style={[styles.filterText,todayView===v.id&&styles.filterTextActive]}>{v.label}</Text><Text style={[styles.filterText,todayView===v.id&&styles.filterTextActive]}>{todayGroups[v.id].length}</Text></TouchableOpacity>)}
      </View>}
      <Text style={styles.explanation}>{filter === 'today'
        ? 'مواعيد اليوم التزامات مسجّلة؛ الأولويات اقتراحات النظام. الحساب المشترك يحمل الشارتين ويظهر مرة واحدة في «الكل».'
        : filter === 'never_followed' ? 'حسابات مسندة لم تُسجّل لها متابعة؛ الوعد أو التحصيل وحده لا يُخرجها من القائمة.'
        : filter === 'scheduled' ? 'مهام بمواعيد مستقبلية.' : 'مهام فات موعدها ولم تُنجز.'}</Text>
      <FlatList
          data={tasks}
          keyExtractor={(item) => item.id}
          renderItem={renderTask}
          contentContainerStyle={tasks.length === 0 ? styles.empty : undefined}
          ListEmptyComponent={
            <TouchableOpacity disabled={!canCreate || filter === 'never_followed'} onPress={() => navigation.navigate('NewTask')}>
              <Text style={styles.emptyText}>{filter === 'never_followed' ? 'لا توجد حسابات دون متابعة ضمن القائمة الحالية' : `لا توجد مهام في تبويب «${FILTER_LABELS[filter]}»${canCreate ? ' — اضغط هنا لإنشاء مهمة' : ''}`}</Text>
            </TouchableOpacity>
          }
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            try { await triggerSync(); await load(); } finally { setRefreshing(false); }
          }}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={50}
          windowSize={5}
          removeClippedSubviews
        />
    </View>
  );
}

const styles = StyleSheet.create({
  badges: {flexDirection:'row-reverse',flexWrap:'wrap',gap:4,marginTop:5},
  manualBadge:{fontFamily:'TajawalBold',fontSize:12,color:colors.primary,backgroundColor:colors.primarySoft,paddingHorizontal:6,paddingVertical:3,borderRadius:8},
  automaticBadge:{fontFamily:'TajawalBold',fontSize:12,color:colors.ink,backgroundColor:colors.goldSoft,paddingHorizontal:6,paddingVertical:3,borderRadius:8},
  explanation: {fontFamily:'TajawalRegular',fontSize:13,color:colors.muted,textAlign:'right',marginHorizontal:18,marginTop:10},
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', padding: 18, backgroundColor: colors.primary },
  eyebrow: { fontFamily: 'TajawalBold', fontSize: 13, fontWeight: '900', color: colors.gold, textAlign: 'right' },
  title: { fontFamily: 'TajawalBold', fontSize: 23, fontWeight: '900', color: '#fff', textAlign: 'right' },
  subtitle: { fontFamily: 'TajawalRegular', fontSize: 13, color: '#B9CCC7', marginTop: 4, textAlign: 'right' },
  addBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, backgroundColor: colors.gold, paddingHorizontal: 13, paddingVertical: 10, borderRadius: radius.pill },
  addBtnText: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.primary, fontWeight: '900' },
  searchWrap: { marginHorizontal: 14, marginTop: 12, paddingHorizontal: 13, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, flexDirection: 'row-reverse', alignItems: 'center', gap: 8, ...shadow },
  searchInput: { fontFamily: 'TajawalRegular', flex: 1, color: colors.ink, fontSize: 15, paddingVertical: 10 },
  filters: { flexDirection: 'row-reverse', gap: 7, marginHorizontal: 14, marginTop: 10 },
  filterButton: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  filterButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { fontFamily: 'TajawalBold', color: colors.muted, fontSize: 13, fontWeight: '800' },
  filterTextActive: { color: '#fff' },
  taskItem: { backgroundColor: colors.surface, marginHorizontal: 14, marginTop: 10, padding: 14, borderRadius: radius.md, flexDirection: 'row-reverse', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.line, ...shadow },
  focusedTask: { borderColor: colors.gold, borderWidth: 2, backgroundColor: colors.goldSoft },
  taskIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' },
  taskName: { fontFamily: 'TajawalBold', fontSize: 16, color: colors.ink, fontWeight: '800', textAlign: 'right' },
  taskReason: { fontFamily: 'TajawalRegular', fontSize: 13, color: colors.muted, marginTop: 4, textAlign: 'right' },
  taskAmount: { fontFamily: 'TajawalBold', fontSize: 14, color: colors.danger, marginTop: 5, fontWeight: '900', textAlign: 'right' },
  taskSide: { alignItems: 'flex-start', minWidth: 68 },
  taskDue: { fontFamily: 'TajawalRegular', fontSize: 13, color: colors.muted },
  taskType: { fontFamily: 'TajawalBold', fontSize: 13, color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 7, paddingVertical: 4, borderRadius: radius.pill, marginTop: 5, fontWeight: '800' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 16, fontWeight: '700', textAlign: 'center', padding: 20 },
});
