import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking, Platform } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchCustomer360 } from '../api/endpoints';
import { getById } from '../db/database';
import { useFocusEffect } from '@react-navigation/native';
import Loading from '../components/loading';
import { apiErrorMessage, parseJsonField } from '../utils/errors';

function cleanPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 9 && !digits.startsWith('967')) digits = '967' + digits;
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits;
}

async function openLink(url: string, fallbackMsg: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) { await Linking.openURL(url); }
    else { Alert.alert('تنبيه', fallbackMsg); }
  } catch { Alert.alert('خطأ', 'تعذر فتح التطبيق'); }
}

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

      {!!phone && (
        <View style={styles.contactRow}>
          <ContactBtn label="اتصال" color="#1a73e8" onPress={() => openLink(`tel:${phone}`, 'لا يوجد تطبيق اتصال')} />
          <ContactBtn label="رسالة" color="#34a853" onPress={() => openLink(`sms:${phone}`, 'لا يوجد تطبيق رسائل')} />
          <ContactBtn label="واتساب" color="#25D366" onPress={() => {
            const cleaned = cleanPhone(phone);
            openLink(`https://wa.me/${cleaned}`, 'لا يوجد واتساب');
          }} />
        </View>
      )}

      <View style={styles.locationRow}>
        <Text style={styles.locationLabel}>الموقع</Text>
        <TouchableOpacity
          style={styles.locationBtn}
          onPress={() => {
            if (address) {
              openLink(
                Platform.OS === 'ios'
                  ? `maps:0,0?q=${encodeURIComponent(address)}`
                  : `geo:0,0?q=${encodeURIComponent(address)}`,
                'لا يوجد تطبيق خرائط',
              );
            } else {
              Alert.alert('تنبيه', 'لا يوجد عنوان مسجل لهذا العميل');
            }
          }}
        >
          <Text style={styles.locationBtnText}>
            {address ? '📍 فتح في الخريطة' : 'لا يوجد عنوان مسجل'}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>الأرصدة</Text>
      {balances.length === 0 ? (
        <Text style={styles.emptyText}>لا توجد أرصدة</Text>
      ) : (
        balances.map((b: any, i: number) => {
          if (!b || typeof b !== 'object') return null;
          const currency = b.currency || b.currencyCode || '';
          const operational = Number(b.operationalBalance ?? b.accountingBalance ?? 0);
          const accounting = Number(b.accountingBalance ?? 0);
          const showAccounting = Math.abs(operational - accounting) > 0.001;
          return (
            <View key={`${currency}-${i}`} style={styles.balanceCard}>
              <View style={styles.balanceHeader}>
                <Text style={styles.balanceCurrency}>{currency}</Text>
                <Text style={styles.balanceValue}>{Number.isFinite(operational) ? operational.toLocaleString('en-US') : '0'}</Text>
              </View>
              {showAccounting && (
                <View style={styles.balanceSubRow}>
                  <Text style={styles.balanceSubLabel}>الرصيد المحاسبي</Text>
                  <Text style={styles.balanceSubValue}>{Number.isFinite(accounting) ? accounting.toLocaleString('en-US') : '0'}</Text>
                </View>
              )}
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

function ContactBtn({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.contactBtn, { backgroundColor: color }]} onPress={onPress}>
      <Text style={styles.contactBtnText}>{label}</Text>
    </TouchableOpacity>
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
  balanceCard: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 10 },
  balanceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balanceSubRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#f0f4f8' },
  balanceSubLabel: { fontSize: 12, color: '#999' },
  balanceSubValue: { fontSize: 12, color: '#666' },
  balanceCurrency: { fontSize: 16, color: '#333', fontWeight: '500' },
  balanceValue: { fontSize: 18, color: '#1a73e8', fontWeight: 'bold' },
  contactRow: { flexDirection: 'row', padding: 12, gap: 8 },
  contactBtn: { flex: 1, padding: 10, borderRadius: 10, alignItems: 'center' },
  contactBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  locationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  locationLabel: { fontSize: 14, fontWeight: '600', color: '#333' },
  locationBtn: { backgroundColor: '#f0f4f8', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#ddd' },
  locationBtnText: { fontSize: 14, color: '#1a73e8', fontWeight: '600' },
  actions: { flexDirection: 'row', padding: 16, gap: 8 },
  actionBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  timelineItem: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 4, padding: 12, borderRadius: 8 },
  timelineTitle: { fontSize: 14, color: '#333' },
  timelineDate: { fontSize: 12, color: '#999', marginTop: 2 },
});
