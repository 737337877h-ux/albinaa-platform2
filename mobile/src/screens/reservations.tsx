import React from 'react';
import { isOperationsApp } from '../config/product';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getAll } from '../db/database';
import { colors, radius } from '../theme';
import { useAuth } from '../store/auth-context';
import { canUseMobileFeature } from '../utils/mobile-permissions';
import { matchesSmartSearch } from '../utils/search';

const RESERVATION_STATUS_LABELS: Record<string, string> = {
  open: 'مفتوح', active: 'نشط', partial: 'منصرف جزئيًا',
  completed: 'مكتمل', expired: 'منتهي', cancelled: 'ملغي',
};

export default function ReservationsScreen({ navigation }: any) {
  const { user } = useAuth();
  const canCreate = canUseMobileFeature(user?.permissions, 'mobile.reservations.create', 'reservations.create');
  const [rows, setRows] = React.useState<any[]>([]);
  const [search, setSearch] = React.useState('');
  const filteredRows = React.useMemo(
    () => rows.map((item) => ['cancelled', 'completed', 'fulfilled'].includes(item.status)
      ? { ...item, remainingQty: 0, totalAmount: 0, totalTons: 0, averageTonPrice: null } : item
    ).filter((item) => matchesSmartSearch(item.customerName, search)),
    [rows, search],
  );
  useFocusEffect(React.useCallback(() => { getAll('reservations').then(setRows); }, []));
  return <View style={styles.screen}>
    <View style={styles.hero}>
      <View style={styles.heroRow}>
        <View style={styles.heroText}>
          <Text style={styles.title}>حجوزات البضاعة</Text>
          <Text style={styles.subtitle}>الحجوزات التابعة للحسابات المسندة إليك</Text>
        </View>
        {canCreate && <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('NewReservation')}>
          <Ionicons name="add" size={20} color={colors.primary} />
          <Text style={styles.addButtonText}>إضافة حجز</Text>
        </TouchableOpacity>}
      </View>
    </View>
    <View style={styles.searchBar}>
      <Ionicons name="search-outline" size={20} color={colors.muted} />
      <TextInput
        style={styles.searchInput}
        value={search}
        onChangeText={setSearch}
        placeholder="ابحث باسم العميل…"
        placeholderTextColor={colors.muted}
        accessibilityLabel="البحث باسم العميل في الحجوزات"
        autoCorrect={false}
        returnKeyType="search"
      />
      {search.length > 0 && <TouchableOpacity
        style={styles.clearSearch}
        onPress={() => setSearch('')}
        accessibilityRole="button"
        accessibilityLabel="مسح البحث"
      >
        <Ionicons name="close-circle" size={22} color={colors.muted} />
      </TouchableOpacity>}
    </View>
    <FlatList
      data={filteredRows}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>{rows.length > 0 ? 'لا توجد حجوزات مطابقة للبحث' : 'لا توجد حجوزات في نطاقك'}</Text>}
      renderItem={({ item }) => (
        <TouchableOpacity disabled={isOperationsApp} style={styles.card} onPress={() => item.customerId && navigation.navigate('Customer360', { id: item.customerId })}>
          <View style={styles.top}>
            <View style={styles.icon}><Ionicons name="cube-outline" size={20} color={colors.gold} /></View>
            <View style={styles.main}>
              <Text style={styles.name}>{item.customerName || 'عميل'}</Text>
              <Text style={styles.item}>{item.itemName || 'حجز بضاعة'} · {RESERVATION_STATUS_LABELS[item.status] || 'غير محدد'}</Text>
            </View>
          </View>
          <View style={styles.metrics}>
            <Metric label="الكمية المتبقية" value={`${Number(item.remainingQty || 0).toLocaleString('en-US')} ${item.unitName || ''}`} />
            <Metric label="قيمة الحجز المتبقية" value={`${Number(item.totalAmount || 0).toLocaleString('en-US')} ${item.currencyCode || ''}`} />
          </View>
          {item.averageTonPrice != null && <Text style={styles.ton}>متوسط سعر الطن: {Number(item.averageTonPrice).toLocaleString('en-US', { maximumFractionDigits: 2 })} {item.currencyCode}</Text>}
        </TouchableOpacity>
      )}
    />
  </View>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  hero: { backgroundColor: colors.primary, padding: 20 },
  heroRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heroText: { flex: 1 },
  addButton: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, backgroundColor: colors.gold, paddingHorizontal: 13, paddingVertical: 11, borderRadius: radius.pill },
  addButtonText: { fontFamily: 'TajawalBold', color: colors.primary, fontWeight: '900', fontSize: 13 },
  title: { fontFamily: 'TajawalBold', color: '#fff', fontSize: 23, fontWeight: '900', textAlign: 'right' },
  subtitle: { fontFamily: 'TajawalRegular', color: '#B9CCC7', fontSize: 13, marginTop: 4, textAlign: 'right' },
  searchBar: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginHorizontal: 14, marginTop: 14, paddingHorizontal: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md },
  searchInput: { fontFamily: 'TajawalRegular', flex: 1, minWidth: 0, color: colors.ink, textAlign: 'right', fontSize: 16, paddingVertical: 12 },
  clearSearch: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 14 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, marginBottom: 9 },
  top: { flexDirection: 'row-reverse', gap: 10, alignItems: 'center' },
  icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1 },
  name: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 15, fontWeight: '900', textAlign: 'right' },
  item: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, marginTop: 4, textAlign: 'right' },
  metrics: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderTopColor: colors.line },
  metricLabel: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, textAlign: 'right' },
  metricValue: { fontFamily: 'TajawalBold', color: colors.ink, fontWeight: '900', fontSize: 13, marginTop: 3 },
  ton: { fontFamily: 'TajawalBold', color: colors.warning, backgroundColor: colors.goldSoft, borderRadius: radius.sm, padding: 9, textAlign: 'right', fontWeight: '800', fontSize: 13, marginTop: 10 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 70 },
});
