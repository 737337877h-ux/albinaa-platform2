import React from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getAll } from '../db/database';
import { colors, radius } from '../theme';
import { useSync } from '../store/sync-context';
import { displayDateFromIso } from '../utils/date-input';
import { localDateKey } from '../utils/local-date';
import { matchesPromiseFilter, PROMISE_FILTER_LABELS, PromiseFilter, promiseBucket, promiseSettledLate, promiseStatusLabel, promiseSummary } from '../utils/promises';

const FILTERS: PromiseFilter[] = ['active', 'upcoming', 'today', 'overdue', 'fulfilled', 'cancelled', 'all'];
const filterValue = (value: unknown): PromiseFilter => FILTERS.includes(value as PromiseFilter) ? value as PromiseFilter : 'active';
const dateLabel = (value: unknown) => value ? displayDateFromIso(String(value).slice(0, 10)) : '—';
const FILTER_HINTS: Record<PromiseFilter, string> = {
  active: 'وعود قادمة أو مستحقة لم يكتمل سدادها؛ الوعود المنفذة والملغاة ضمن سجلها.',
  upcoming: 'وعود مفتوحة بمواعيد بعد اليوم.',
  today: 'وعود مفتوحة يحين موعد سدادها اليوم.',
  overdue: 'وعود تجاوزت موعدها وما زالت تحتاج متابعة، بما فيها السداد الجزئي.',
  fulfilled: 'الوعود التي تم سدادها، مع توضيح السداد بعد الموعد عند وجوده.',
  cancelled: 'وعود أُلغيَت بموافقة؛ لا تدخل في عداد الوعود قيد المتابعة.',
  all: 'السجل الكامل لجميع الحالات محفوظ هنا.',
};

export default function PromisesListScreen({ navigation, route }: any) {
  const [rows, setRows] = React.useState<any[]>([]);
  const [filter, setFilter] = React.useState<PromiseFilter>(filterValue(route?.params?.initialFilter));
  const [search, setSearch] = React.useState('');
  const { status } = useSync();
  const load = React.useCallback(() => getAll('promises').then(setRows), []);
  useFocusEffect(React.useCallback(() => { void load(); }, [load]));
  React.useEffect(() => {
    if (status.phase === 'synced' && status.lastSyncAt) void load();
  }, [load, status.phase, status.lastSyncAt]);
  React.useEffect(() => {
    if (route?.params?.initialFilter) setFilter(filterValue(route.params.initialFilter));
  }, [route?.params?.initialFilter]);
  const today = localDateKey(new Date());
  const counts = promiseSummary(rows, today);
  const query = search.trim().toLowerCase();
  const visibleRows = rows.filter(item => matchesPromiseFilter(item, filter, today)
    && (!query || String(item.customerName || '').toLowerCase().includes(query)));
  visibleRows.sort((a, b) => {
    const aDate = String(filter === 'fulfilled' ? a.settlementDate || a.dueDate || '' : a.dueDate || '');
    const bDate = String(filter === 'fulfilled' ? b.settlementDate || b.dueDate || '' : b.dueDate || '');
    return filter === 'fulfilled' || filter === 'all' ? bDate.localeCompare(aDate) : aDate.localeCompare(bDate);
  });

  return <View style={styles.screen}>
    <View style={styles.hero}><Text style={styles.title}>وعود السداد</Text><Text style={styles.subtitle}>{counts.active.toLocaleString('en-US')} قيد المتابعة · {counts.all.toLocaleString('en-US')} في السجل</Text></View>
    <View style={styles.search}>
      <Ionicons name="search-outline" size={20} color={colors.muted} />
      <TextInput value={search} onChangeText={setSearch} style={styles.searchInput} placeholder="ابحث باسم العميل..." placeholderTextColor={colors.muted} textAlign="right" returnKeyType="search" />
      {!!search && <TouchableOpacity accessibilityLabel="مسح البحث" onPress={() => setSearch('')}><Ionicons name="close-circle" size={20} color={colors.muted} /></TouchableOpacity>}
    </View>
    <View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
      {FILTERS.map(value => <TouchableOpacity key={value} accessibilityRole="button" accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)} style={[styles.filter, filter === value && styles.filterActive]}>
        <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{PROMISE_FILTER_LABELS[value]} · {counts[value].toLocaleString('en-US')}</Text>
      </TouchableOpacity>)}
    </ScrollView></View>
    <Text style={styles.hint}>{FILTER_HINTS[filter]}</Text>
    {!!query && <Text style={styles.searchCount}>{visibleRows.length.toLocaleString('en-US')} نتيجة</Text>}
    <FlatList data={visibleRows} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" ListEmptyComponent={<Text style={styles.empty}>{query ? 'لا توجد وعود تطابق البحث' : `لا توجد وعود في «${PROMISE_FILTER_LABELS[filter]}»`}</Text>} renderItem={({ item }) => {
      const bucket = promiseBucket(item, today);
      const late = bucket === 'fulfilled' && promiseSettledLate(item);
      return <TouchableOpacity style={styles.card} onPress={() => item.customerId && navigation.navigate('Customer360', { id: item.customerId })}>
        <View style={styles.icon}><Ionicons name={bucket === 'fulfilled' ? 'checkmark-circle-outline' : bucket === 'cancelled' ? 'close-circle-outline' : 'calendar-outline'} size={20} color={bucket === 'fulfilled' ? colors.success : colors.gold} /></View>
        <View style={styles.main}>
          <Text style={styles.name}>{item.customerName || 'عميل'}</Text>
          <Text style={styles.date}>الاستحقاق: {dateLabel(item.dueDate)}</Text>
          <Text style={[styles.status, bucket === 'overdue' && styles.overdue, bucket === 'fulfilled' && styles.fulfilled, bucket === 'cancelled' && styles.cancelled]}>{promiseStatusLabel(item, today)}</Text>
          {bucket !== 'fulfilled' && Number(item.fulfilledAmount ?? 0)>0 && <Text style={styles.date}>المسدّد: {Number(item.fulfilledAmount).toLocaleString('en-US')} · المتبقي: {Math.max(0,Number(item.expectedAmount)-Number(item.fulfilledAmount)).toLocaleString('en-US')} {item.currencyCode}</Text>}
          {bucket === 'fulfilled' && !!item.settlementDate && <Text style={styles.date}>السداد: {dateLabel(item.settlementDate)}</Text>}
          {late && !!item.missedDueDate && <Text style={styles.lateNote}>تاريخ التأخر محفوظ: {dateLabel(item.missedDueDate)}</Text>}
        </View>
        <View><Text style={styles.amount}>{Number(item.expectedAmount || 0).toLocaleString('en-US')}</Text><Text style={styles.currency}>{item.currencyCode}</Text></View>
      </TouchableOpacity>;
    }} />
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, hero: { backgroundColor: colors.primary, padding: 20 },
  title: { fontFamily: 'TajawalBold', color: '#fff', fontSize: 23, fontWeight: '900', textAlign: 'right' },
  subtitle: { fontFamily: 'TajawalRegular', color: '#B9CCC7', fontSize: 13, marginTop: 4, textAlign: 'right' },
  search: { marginHorizontal: 14, marginTop: 12, flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 12 },
  searchInput: { flex: 1, minHeight: 46, fontFamily: 'TajawalRegular', fontSize: 15, color: colors.ink },
  filters: { flexDirection: 'row-reverse', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  filter: { minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderColor: colors.line, borderWidth: 1, borderRadius: radius.pill, backgroundColor: colors.surface },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { fontFamily: 'TajawalBold', color: colors.muted, fontSize: 13 }, filterTextActive: { color: '#fff' },
  hint: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, textAlign: 'right', paddingHorizontal: 16, paddingBottom: 5 },
  searchCount: { fontFamily: 'TajawalBold', color: colors.primary, textAlign: 'right', paddingHorizontal: 16 },
  list: { padding: 14 },
  card: { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 9, flexDirection: 'row-reverse', gap: 10, alignItems: 'center' },
  icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1 }, name: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 15, fontWeight: '900', textAlign: 'right' },
  date: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, marginTop: 4, textAlign: 'right' },
  status: { alignSelf: 'flex-end', fontFamily: 'TajawalBold', fontSize: 12, color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, marginTop: 6 },
  overdue: { color: colors.danger, backgroundColor: colors.dangerSoft }, fulfilled: { color: colors.success }, cancelled: { color: colors.muted, backgroundColor: colors.line },
  lateNote: { fontFamily: 'TajawalRegular', fontSize: 12, color: colors.warning, textAlign: 'right', marginTop: 4 },
  amount: { fontFamily: 'TajawalBold', color: colors.danger, fontWeight: '900', fontSize: 15 }, currency: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13 },
  empty: { fontFamily: 'TajawalRegular', color: colors.muted, textAlign: 'center', marginTop: 40 },
});
