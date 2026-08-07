import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking, Platform, Modal, FlatList, TextInput } from 'react-native';
import { enqueueMutation, getCustomerOffline360, updateCustomerPhoneOffline } from '../db/database';
import { useFocusEffect } from '@react-navigation/native';
import Loading from '../components/loading';
import { parseJsonField } from '../utils/errors';
import { contactLinks } from '../utils/contact';
import { useSync } from '../store/sync-context';
import * as Contacts from 'expo-contacts';
import { colors, radius } from '../theme';
import { generateIdempotencyKey } from '../utils/constants';

async function openLink(url: string, fallbackMsg: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) { await Linking.openURL(url); }
    else { Alert.alert('تنبيه', fallbackMsg); }
  } catch { Alert.alert('خطأ', 'تعذر فتح التطبيق'); }
}

export default function Customer360Screen({ route, navigation }: any) {
  const id = route?.params?.id;
  const routeCustomer = route?.params?.customer;
  const { triggerSync } = useSync();
  // Keep the row selected by the user visible while a full snapshot is being
  // committed. The database copy replaces it as soon as it is readable.
  const [local, setLocal] = React.useState<any>(routeCustomer || null);
  const [loading, setLoading] = React.useState(true);
  const [contactModal, setContactModal] = React.useState(false);
  const [deviceContacts, setDeviceContacts] = React.useState<Contacts.ExistingContact[]>([]);
  const [contactSearch, setContactSearch] = React.useState('');
  const loadLocal = React.useCallback(async () => {
    if (!id) return;
    const cached = await getCustomerOffline360(String(id));
    if (cached) setLocal(cached);
    else if (!routeCustomer) setLocal(null);
    setLoading(false);
  }, [id, routeCustomer]);
  useFocusEffect(
    React.useCallback(() => {
      if (!id) return;
      loadLocal().catch(() => setLoading(false));
    }, [id, loadLocal]),
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

  const customer = local;
  if (loading && !customer) return <Loading />;
  if (!customer) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>العميل غير موجود في بيانات الهاتف</Text>
        <TouchableOpacity onPress={async () => { await triggerSync(); await loadLocal(); }} style={styles.backBtn}>
          <Text style={styles.backText}>إعادة المحاولة</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const balances = parseJsonField<any[]>(customer.balances, Array.isArray(customer.balances) ? customer.balances : []);
  const timeline = Array.isArray(customer.timeline) ? customer.timeline : [];
  const fullName = customer.fullName || customer.name || 'عميل';
  const phone = customer.phonePrimary || customer.phone || '';
  const links = contactLinks(phone);
  const address = customer.address || '';
  const accountCode = customer.accountNumber || customer.externalCustomerCode || '';
  const hasCoordinates = Number.isFinite(Number(customer.geoLat)) && Number.isFinite(Number(customer.geoLng));

  const saveToContacts = async () => {
    const permission = await Contacts.requestPermissionsAsync();
    if (permission.status !== 'granted') { Alert.alert('الصلاحية مطلوبة', 'اسمح للتطبيق بالوصول إلى جهات الاتصال.'); return; }
    await Contacts.addContactAsync({
      contactType: Contacts.ContactTypes.Person,
      [Contacts.Fields.Name]: fullName,
      [Contacts.Fields.PhoneNumbers]: phone ? [{ label: 'الراقي', number: phone }] : [],
    });
    Alert.alert('تم الحفظ', 'أضيف العميل إلى جهات اتصال الهاتف.');
  };

  const openContactPicker = async () => {
    const permission = await Contacts.requestPermissionsAsync();
    if (permission.status !== 'granted') { Alert.alert('الصلاحية مطلوبة', 'اسمح للتطبيق بقراءة جهات الاتصال.'); return; }
    const result = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers], sort: Contacts.SortTypes.FirstName });
    setDeviceContacts(result.data.filter((contact) => contact.phoneNumbers?.length));
    setContactModal(true);
  };

  const chooseContactNumber = async (contact: Contacts.ExistingContact) => {
    const number = contact.phoneNumbers?.[0]?.number;
    if (!number) return;
    await updateCustomerPhoneOffline(id, number);
    await enqueueMutation(generateIdempotencyKey(), 'PATCH', `/customers/${id}`, { phonePrimary: number });
    setContactModal(false);
    await loadLocal();
    Alert.alert('تم الحفظ محلياً', 'تم تحديث رقم العميل وسيُرسل إلى الخادم عند المزامنة.');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.name}>{fullName}</Text>
        {!!accountCode && <Text style={styles.accountCode}>كود الحساب #{accountCode}</Text>}
        {!!phone && <Text style={styles.phone}>{phone}</Text>}
        {!!address && <Text style={styles.address}>{address}</Text>}
      </View>

      {!!links && (
        <View style={styles.contactRow}>
          <ContactBtn label="اتصال" color="#1a73e8" onPress={() => openLink(links.tel, 'لا يوجد تطبيق اتصال')} />
          <ContactBtn label="رسالة" color="#34a853" onPress={() => openLink(links.sms, 'لا يوجد تطبيق رسائل')} />
          <ContactBtn label="واتساب" color="#25D366" onPress={() => openLink(links.whatsapp, 'لا يوجد واتساب')} />
        </View>
      )}
      {!!phone && <TouchableOpacity style={styles.saveContact} onPress={saveToContacts}><Text style={styles.saveContactText}>حفظ العميل في جهات الاتصال</Text></TouchableOpacity>}
      <TouchableOpacity style={styles.importContact} onPress={openContactPicker}><Text style={styles.importContactText}>اختيار رقم العميل من دفتر الهاتف</Text></TouchableOpacity>

      <View style={styles.locationRow}>
        <Text style={styles.locationLabel}>الموقع</Text>
        <TouchableOpacity
          style={styles.locationBtn}
          onPress={() => {
            if (hasCoordinates || address) {
              openLink(
                Platform.OS === 'ios'
                  ? `maps:0,0?q=${hasCoordinates ? `${customer.geoLat},${customer.geoLng}` : encodeURIComponent(address)}`
                  : `geo:0,0?q=${hasCoordinates ? `${customer.geoLat},${customer.geoLng}` : encodeURIComponent(address)}`,
                'لا يوجد تطبيق خرائط',
              );
            } else {
              Alert.alert('تنبيه', 'لا يوجد عنوان مسجل لهذا العميل');
            }
          }}
        >
          <Text style={styles.locationBtnText}>
            {hasCoordinates || address ? 'فتح الموقع في الخريطة' : 'لا يوجد موقع مسجل'}
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
          const operational = Number(b.operationalBalance ?? b.accountingBalance ?? b.balance ?? 0);
          const accounting = Number(b.accountingBalance ?? b.balance ?? 0);
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

      <Modal visible={contactModal} animationType="slide" onRequestClose={() => setContactModal(false)}>
        <View style={styles.contactModal}>
          <View style={styles.modalHead}><TouchableOpacity onPress={() => setContactModal(false)}><Text style={styles.modalClose}>إغلاق</Text></TouchableOpacity><Text style={styles.modalTitle}>اختيار رقم من جهات الاتصال</Text></View>
          <TextInput style={styles.contactSearch} placeholder="بحث بالاسم أو الرقم" value={contactSearch} onChangeText={setContactSearch} textAlign="right" />
          <FlatList
            data={deviceContacts.filter((contact) => !contactSearch || `${contact.name} ${contact.phoneNumbers?.[0]?.number}`.toLowerCase().includes(contactSearch.toLowerCase()))}
            keyExtractor={(contact) => contact.id || `${contact.name}-${contact.phoneNumbers?.[0]?.number}`}
            renderItem={({ item }) => <TouchableOpacity style={styles.deviceContact} onPress={() => chooseContactNumber(item)}><Text style={styles.deviceContactName}>{item.name || 'بدون اسم'}</Text><Text style={styles.deviceContactPhone}>{item.phoneNumbers?.[0]?.number}</Text></TouchableOpacity>}
          />
        </View>
      </Modal>
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
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  error: { color: '#ea4335', fontSize: 16, textAlign: 'center' },
  backBtn: { marginTop: 16, padding: 12 },
  backText: { color: '#1a73e8', fontSize: 16 },
  header: { backgroundColor: colors.primary, padding: 20 },
  name: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  phone: { fontSize: 16, color: '#fff', marginTop: 4, opacity: 0.9 },
  accountCode: { fontSize: 12, color: colors.gold, marginTop: 5, fontWeight: '800' },
  address: { fontSize: 14, color: '#fff', marginTop: 4, opacity: 0.7 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#333', padding: 16, paddingBottom: 8 },
  emptyText: { textAlign: 'center', color: '#999', padding: 16 },
  balanceCard: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  balanceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balanceSubRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#f0f4f8' },
  balanceSubLabel: { fontSize: 12, color: '#999' },
  balanceSubValue: { fontSize: 12, color: '#666' },
  balanceCurrency: { fontSize: 16, color: '#333', fontWeight: '500' },
  balanceValue: { fontSize: 18, color: colors.danger, fontWeight: 'bold' },
  contactRow: { flexDirection: 'row', padding: 12, gap: 8 },
  contactBtn: { flex: 1, padding: 10, borderRadius: 10, alignItems: 'center' },
  contactBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  saveContact: { marginHorizontal: 16, marginBottom: 6, padding: 11, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center' },
  saveContactText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  importContact: { marginHorizontal: 16, marginBottom: 8, padding: 11, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary, alignItems: 'center' },
  importContactText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  locationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  locationLabel: { fontSize: 14, fontWeight: '600', color: '#333' },
  locationBtn: { backgroundColor: '#f0f4f8', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#ddd' },
  locationBtnText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  actions: { flexDirection: 'row', padding: 16, gap: 8 },
  actionBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  timelineItem: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 4, padding: 12, borderRadius: 8 },
  timelineTitle: { fontSize: 14, color: '#333' },
  timelineDate: { fontSize: 12, color: '#999', marginTop: 2 },
  contactModal: { flex: 1, backgroundColor: colors.background, paddingTop: 45 },
  modalHead: { backgroundColor: colors.primary, padding: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: '900' }, modalClose: { color: colors.gold, fontWeight: '800' },
  contactSearch: { margin: 14, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 13, color: colors.ink },
  deviceContact: { marginHorizontal: 14, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: '#fff' },
  deviceContactName: { color: colors.ink, fontSize: 15, fontWeight: '800', textAlign: 'right' }, deviceContactPhone: { color: colors.muted, marginTop: 3, textAlign: 'right' },
});
