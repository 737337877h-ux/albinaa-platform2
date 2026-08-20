import React from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { fetchInventoryItems, fetchInventorySummary } from '../api/endpoints';
import { colors, radius, shadow } from '../theme';

export default function InventoryScreen({ navigation }: any) {
  const [search, setSearch] = React.useState('');
  const [submitted, setSubmitted] = React.useState('');
  const summary = useQuery({ queryKey: ['mobile-inventory-summary'], queryFn: async () => (await fetchInventorySummary()).data });
  const items = useQuery({ queryKey: ['mobile-inventory-items', submitted], queryFn: async () => (await fetchInventoryItems(submitted)).data });
  const refreshing = summary.isFetching || items.isFetching;
  const refresh = () => { summary.refetch(); items.refetch(); };

  return (
    <View style={styles.screen}>
      <View style={styles.searchRow}>
        <TouchableOpacity style={styles.searchButton} onPress={() => setSubmitted(search.trim())}><Ionicons name="search" size={20} color="#fff" /></TouchableOpacity>
        <TextInput value={search} onChangeText={setSearch} onSubmitEditing={() => setSubmitted(search.trim())}
          placeholder="اسم الصنف أو الكود أو الباركود" placeholderTextColor={colors.muted} style={styles.input} textAlign="right" returnKeyType="search" />
      </View>
      {!!summary.data && <View style={styles.summaryRow}>
        <Summary label="الأصناف" value={summary.data.counts?.items ?? 0} />
        <Summary label="المستودعات" value={summary.data.counts?.warehouses ?? 0} />
        <Summary label="قيمة المخزون" value={summary.data.valuation?.totalInventoryCost ?? 0} compact />
      </View>}
      {items.isLoading ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : (
        <FlatList data={items.data?.items ?? []} keyExtractor={(item: any) => item.externalItemCode}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>لا توجد أصناف مطابقة</Text>}
          renderItem={({ item }: any) => <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('InventoryItem', { code: item.externalItemCode })}>
            <Ionicons name="chevron-back" size={18} color={colors.muted} />
            <View style={styles.cardMain}><Text style={styles.name}>{item.nameAr}</Text><Text style={styles.meta}>{item.externalItemCode} · {item.group?.nameAr || 'بدون مجموعة'}</Text></View>
            <View style={styles.unitBadge}><Text style={styles.unitCount}>{item._count?.units ?? 0}</Text><Text style={styles.unitLabel}>وحدة</Text></View>
          </TouchableOpacity>}
        />
      )}
    </View>
  );
}

function Summary({ label, value, compact }: { label: string; value: number | string; compact?: boolean }) {
  const number = Number(value || 0);
  return <View style={styles.summary}><Text style={[styles.summaryValue, compact && styles.summaryValueCompact]}>{number.toLocaleString('en-US', { maximumFractionDigits: compact ? 0 : 2 })}</Text><Text style={styles.summaryLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  searchRow: { flexDirection: 'row', gap: 8, padding: 14 },
  input: { flex: 1, minHeight: 48, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14, color: colors.ink },
  searchButton: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  summaryRow: { flexDirection: 'row-reverse', gap: 7, paddingHorizontal: 14, paddingBottom: 10 },
  summary: { flex: 1, minHeight: 76, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  summaryValue: { color: colors.primary, fontWeight: '900', fontSize: 20 }, summaryValueCompact: { fontSize: 15 }, summaryLabel: { color: colors.muted, fontSize: 10, marginTop: 3 },
  loader: { marginTop: 60 }, list: { paddingHorizontal: 14, paddingBottom: 90 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 13, marginBottom: 9, ...shadow },
  cardMain: { flex: 1 }, name: { color: colors.ink, fontWeight: '900', fontSize: 14, textAlign: 'right' }, meta: { color: colors.muted, fontSize: 10, marginTop: 4, textAlign: 'right' },
  unitBadge: { minWidth: 42, alignItems: 'center', backgroundColor: colors.goldSoft, borderRadius: 11, padding: 7 }, unitCount: { color: colors.primary, fontWeight: '900' }, unitLabel: { color: colors.muted, fontSize: 9 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 60 },
});
