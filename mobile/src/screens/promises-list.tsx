import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getAll } from '../db/database';
import { colors, radius } from '../theme';

const PROMISE_STATUS_LABELS: Record<string, string> = {
  upcoming: 'قادم', due_today: 'مستحق اليوم', overdue: 'متأخر',
  fulfilled: 'تم السداد', cancelled: 'ملغي', broken: 'لم يُوفَ به',
};

export default function PromisesListScreen({ navigation }: any) {
  const [rows, setRows] = React.useState<any[]>([]);
  useFocusEffect(React.useCallback(() => { getAll('promises').then(setRows); }, []));
  return <View style={styles.screen}>
    <View style={styles.hero}><Text style={styles.title}>وعود السداد</Text><Text style={styles.subtitle}>{rows.length.toLocaleString('en-US')} وعد محفوظ على الجهاز</Text></View>
    <FlatList data={rows} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>لا توجد وعود مسجلة</Text>} renderItem={({ item }) => (
      <TouchableOpacity style={styles.card} onPress={() => item.customerId && navigation.navigate('Customer360', { id: item.customerId })}>
        <View style={styles.icon}><Ionicons name="calendar-outline" size={20} color={colors.gold} /></View>
        <View style={styles.main}><Text style={styles.name}>{item.customerName || 'عميل'}</Text><Text style={styles.date}>{item.dueDate ? new Date(item.dueDate).toLocaleDateString('ar-YE') : '—'} · {PROMISE_STATUS_LABELS[item.status] || 'قيد المتابعة'}</Text></View>
        <View><Text style={styles.amount}>{Number(item.expectedAmount || 0).toLocaleString('en-US')}</Text><Text style={styles.currency}>{item.currencyCode}</Text></View>
      </TouchableOpacity>
    )} />
  </View>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.background }, hero: { backgroundColor: colors.primary, padding: 20 }, title: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'right' }, subtitle: { color: '#B9CCC7', fontSize: 12, marginTop: 4, textAlign: 'right' }, list: { padding: 14 }, card: { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 9, flexDirection: 'row-reverse', gap: 10, alignItems: 'center' }, icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' }, main: { flex: 1 }, name: { color: colors.ink, fontSize: 14, fontWeight: '900', textAlign: 'right' }, date: { color: colors.muted, fontSize: 11, marginTop: 4, textAlign: 'right' }, amount: { color: colors.danger, fontWeight: '900', fontSize: 14 }, currency: { color: colors.muted, fontSize: 9 }, empty: { color: colors.muted, textAlign: 'center', marginTop: 70 } });
