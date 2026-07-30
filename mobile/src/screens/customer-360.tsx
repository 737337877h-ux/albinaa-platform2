import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchCustomer360 } from '../api/endpoints';
import { getById } from '../db/database';
import { useFocusEffect } from '@react-navigation/native';
import Loading from '../components/loading';
import { apiErrorMessage, parseJsonField } from '../utils/errors';

export default function Customer360Screen({ route, navigation }: any) {
  const id = route?.params?.id;

  const { data: remote, isLoading, error, refetch } = useQuery({
    queryKey: ['customer360', id],
    queryFn: () => fetchCustomer360(id).then((r) => r.data),
    enabled: !!id,
    retry: 1,
  });

  const [local, setLocal] = React.useState<any>(null);
  useFocusEffect(
    React.useCallback(() => {
      if (!id) return;
      (async () => {
        try {
          setLocal(await getById('customers', id));
        } catch {
          setLocal(null);
        }
      })();
      // Refetch from server on focus so latest data is shown
      refetch();
    }, [id, refetch]),
  );

  if (!id) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>معرّف العميل غير متوفر</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>رجوع</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const customer = remote || local;
  if (isLoading && !customer) return <Loading />;
  if (!customer) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{apiErrorMessage(error, 'العميل غير موجود')}</Text>
        <TouchableOpacity onPress={() => refetch()} style={styles.backBtn}>
          <Text style={styles.backText}>إعادة المحاولة</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const balances = parseJsonField<any[]>(customer.balances, Array.isArray(customer.balances) ? customer.balances : []);
  const timeline = Array.isArray(customer.timeline) ? customer.timeline : [];
  const fullName = customer.fullName || customer.name || 'عميل';
  const phone = customer.phonePrimary || customer.phone || '';
  const address = customer.address || '';

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.name}>{fullName}</Text>
        {!!phone && <Text style={styles.phone}>{phone}</Text>}
        {!!address && <Text style={styles.address}>{address}</Text>}
      </View>

      <Text style={styles.sectionTitle}>الأرصدة</Text>
      {balances.length === 0 ? (
        <Text style={styles.emptyText}>لا توجد أرصدة</Text>
      ) : (
        balances.map((b: any, i: number) => {
          if (!b || typeof b !== 'object') return null;
          const currency = b.currency || b.currencyCode || '';
          const value = Number(b.accountingBalance ?? b.balance ?? 0);
          return (
            <View key={`${currency}-${i}`} style={styles.balanceRow}>
              <Text style={styles.balanceCurrency}>{currency}</Text>
              <Text style={styles.balanceValue}>{Number.isFinite(value) ? value.toLocaleString('en-US') : '0'}</Text>
            </View>
          );
        })
      )}

      <View style={styles.actions}>
        <ActionBtn title="متابعة" color="#1a73e8" onPress={() => navigation.navigate('NewFollowup', { customerId: id })} />
        <ActionBtn title="وعد سداد" color="#34a853" onPress={() => navigation.navigate('NewPromise', { customerId: id })} />
        <ActionBtn title="تحصيل" color="#ea4335" onPress={() => navigation.navigate('NewCollection', { customerId: id })} />
      </View>

      <Text style={styles.sectionTitle}>آخر النشاطات</Text>
      {timeline.length === 0 ? (
        <Text style={styles.emptyText}>لا توجد نشاطات</Text>
      ) : (
        timeline.slice(0, 10).map((ev: any, i: number) => {
          if (!ev) return null;
          const at = ev.at ? new Date(ev.at) : null;
          return (
            <View key={i} style={styles.timelineItem}>
              <Text style={styles.timelineTitle}>{ev.title || ev.type || 'نشاط'}</Text>
              <Text style={styles.timelineDate}>
                {at && !Number.isNaN(at.getTime()) ? at.toLocaleDateString('ar-SA') : ''}
              </Text>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function ActionBtn({ title, color, onPress }: { title: string; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { backgroundColor: color }]}
      onPress={() => {
        try {
          onPress();
        } catch (e: any) {
          Alert.alert('خطأ', e?.message || 'تعذر فتح الشاشة');
        }
      }}
    >
      <Text style={styles.actionText}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  error: { color: '#ea4335', fontSize: 16, textAlign: 'center' },
  backBtn: { marginTop: 16, padding: 12 },
  backText: { color: '#1a73e8', fontSize: 16 },
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
