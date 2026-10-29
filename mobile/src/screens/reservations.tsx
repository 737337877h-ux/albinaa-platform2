import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getAll } from '../db/database';
import { colors, radius } from '../theme';
import { useAuth } from '../store/auth-context';
import { canUseMobileFeature } from '../utils/mobile-permissions';

const RESERVATION_STATUS_LABELS: Record<string, string> = {
  open: 'مفتوح', active: 'نشط', partial: 'منصرف جزئيًا',
  completed: 'مكتمل', expired: 'منتهي', cancelled: 'ملغي',
};

export default function ReservationsScreen({ navigation }: any) {
  const { user } = useAuth();
  const canCreate = canUseMobileFeature(user?.permissions, 'mobile.reservations.create', 'reservations.create');
  const [rows, setRows] = React.useState<any[]>([]);
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
    <FlatList
      data={rows}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>لا توجد حجوزات في نطاقك</Text>}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.card} onPress={() => item.customerId && navigation.navigate('Customer360', { id: item.customerId })}>
          <View style={styles.top}>
            <View style={styles.icon}><Ionicons name="cube-outline" size={20} color={colors.gold} /></View>
            <View style={styles.main}>
              <Text style={styles.name}>{item.customerName || 'عميل'}</Text>
              <Text style={styles.item}>{item.itemName || 'حجز بضاعة'} · {RESERVATION_STATUS_LABELS[item.status] || 'غير محدد'}</Text>
            </View>
          </View>
          <View style={styles.metrics}>
            <Metric label="الكمية المتبقية" value={`${Number(item.remainingQty || 0).toLocaleString('en-US')} ${item.unitName || ''}`} />
            <Metric label="إجمالي الحجز" value={`${Number(item.totalAmount || 0).toLocaleString('en-US')} ${item.currencyCode || ''}`} />
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
  addButtonText: { color: colors.primary, fontWeight: '900', fontSize: 12 },
  title: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'right' },
  subtitle: { color: '#B9CCC7', fontSize: 12, marginTop: 4, textAlign: 'right' },
  list: { padding: 14 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, marginBottom: 9 },
  top: { flexDirection: 'row-reverse', gap: 10, alignItems: 'center' },
  icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1 },
  name: { color: colors.ink, fontSize: 14, fontWeight: '900', textAlign: 'right' },
  item: { color: colors.muted, fontSize: 11, marginTop: 4, textAlign: 'right' },
  metrics: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderTopColor: colors.line },
  metricLabel: { color: colors.muted, fontSize: 10, textAlign: 'right' },
  metricValue: { color: colors.ink, fontWeight: '900', fontSize: 12, marginTop: 3 },
  ton: { color: colors.warning, backgroundColor: colors.goldSoft, borderRadius: radius.sm, padding: 9, textAlign: 'right', fontWeight: '800', fontSize: 11, marginTop: 10 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 70 },
});
