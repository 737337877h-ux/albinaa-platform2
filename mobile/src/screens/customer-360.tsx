import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchCustomer360 } from '../api/endpoints';
import { getById } from '../db/database';
import { useFocusEffect } from '@react-navigation/native';
import Loading from '../components/loading';

export default function Customer360Screen({ route, navigation }: any) {
  const { id } = route.params;

  const { data: remote, isLoading } = useQuery({
    queryKey: ['customer360', id],
    queryFn: () => fetchCustomer360(id).then((r) => r.data),
  });

  const [local, setLocal] = React.useState<any>(null);
  useFocusEffect(
    React.useCallback(() => {
      (async () => { setLocal(await getById('customers', id)); })();
    }, [id]),
  );

  const customer = remote || local;
  if (isLoading && !customer) return <Loading />;
  if (!customer) return <View style={styles.center}><Text style={styles.error}>العميل غير موجود</Text></View>;

  const balances = customer.balances || [];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.name}>{customer.fullName}</Text>
        <Text style={styles.phone}>{customer.phonePrimary}</Text>
        <Text style={styles.address}>{customer.address}</Text>
      </View>

      <Text style={styles.sectionTitle}>الأرصدة</Text>
      {balances.length === 0 ? (
        <Text style={styles.emptyText}>لا توجد أرصدة</Text>
      ) : (
        balances.map((b: any, i: number) => (
          <View key={i} style={styles.balanceRow}>
            <Text style={styles.balanceCurrency}>{b.currency || b.currencyCode}</Text>
            <Text style={styles.balanceValue}>{Number(b.accountingBalance || b.balance || 0).toLocaleString('en-US')}</Text>
          </View>
        ))
      )}

      <View style={styles.actions}>
        <ActionBtn title="متابعة" color="#1a73e8" onPress={() => navigation.navigate('NewFollowup', { customerId: id })} />
        <ActionBtn title="وعد سداد" color="#34a853" onPress={() => navigation.navigate('NewPromise', { customerId: id })} />
        <ActionBtn title="تحصيل" color="#ea4335" onPress={() => navigation.navigate('NewCollection', { customerId: id })} />
      </View>

      <Text style={styles.sectionTitle}>آخر النشاطات</Text>
      {(customer.timeline || []).slice(0, 10).map((ev: any, i: number) => (
        <View key={i} style={styles.timelineItem}>
          <Text style={styles.timelineTitle}>{ev.title}</Text>
          <Text style={styles.timelineDate}>{new Date(ev.at).toLocaleDateString('ar-SA')}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function ActionBtn({ title, color, onPress }: { title: string; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: color }]} onPress={onPress}>
      <Text style={styles.actionText}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  error: { color: '#ea4335', fontSize: 16 },
  header: { backgroundColor: '#1a73e8', padding: 20 },
  name: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  phone: { fontSize: 16, color: '#fff', marginTop: 4, opacity: 0.9 },
  address: { fontSize: 14, color: '#fff', marginTop: 4, opacity: 0.7 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#333', padding: 16, paddingBottom: 8 },
  emptyText: { textAlign: 'center', color: '#999', padding: 16 },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 4, padding: 12, borderRadius: 8 },
  balanceCurrency: { fontSize: 16, color: '#333' },
  balanceValue: { fontSize: 16, color: '#1a73e8', fontWeight: '600' },
  actions: { flexDirection: 'row', padding: 16, gap: 8 },
  actionBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  timelineItem: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 4, padding: 12, borderRadius: 8 },
  timelineTitle: { fontSize: 14, color: '#333' },
  timelineDate: { fontSize: 12, color: '#999', marginTop: 2 },
});
