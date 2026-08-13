import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking, Platform, Modal, FlatList, TextInput, KeyboardAvoidingView, Keyboard } from 'react-native';
import { enqueueMutation, getCustomerOffline360, updateCustomerContactOffline } from '../db/database';
import { useFocusEffect } from '@react-navigation/native';
import Loading from '../components/loading';
import { parseJsonField } from '../utils/errors';
import { contactLinks } from '../utils/contact';
import { useSync } from '../store/sync-context';
// SDK 57 exposes the imperative contact APIs through the legacy entry point.
import * as Contacts from 'expo-contacts/legacy';
import { colors, radius } from '../theme';
import { generateIdempotencyKey } from '../utils/constants';
import { Ionicons } from '@expo/vector-icons';
import { loadMessageTemplates, MessageChannel, MessageTemplate, renderMessageTemplate } from '../utils/message-templates';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

async function openLink(url: string, fallbackMsg: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) { await Linking.openURL(url); }
    else { Alert.alert('تنبيه', fallbackMsg); }
  } catch { Alert.alert('خطأ', 'تعذر فتح التطبيق'); }
}

export default function Customer360Screen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
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
  const [phoneEditorOpen, setPhoneEditorOpen] = React.useState(false);
  const [phoneDraft, setPhoneDraft] = React.useState({ phonePrimary: '', phoneSecondary: '', whatsapp: '' });
  const [templates, setTemplates] = React.useState<MessageTemplate[]>([]);
  const [messageChannel, setMessageChannel] = React.useState<Exclude<MessageChannel, 'both'> | null>(null);
  const [assignmentRequestOpen, setAssignmentRequestOpen] = React.useState(false);
  const [assignmentReason, setAssignmentReason] = React.useState('');
  const [modalKeyboardHeight, setModalKeyboardHeight] = React.useState(0);
  React.useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      if (Platform.OS === 'android') setModalKeyboardHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setModalKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
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
      loadMessageTemplates().then(setTemplates);
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
  const phoneSecondary = customer.phoneSecondary || '';
  const whatsapp = customer.whatsapp || phone;
  const links = contactLinks(phone || phoneSecondary || whatsapp);
  const secondaryLinks = contactLinks(phoneSecondary);
  const whatsappLinks = contactLinks(whatsapp);
  const availablePhones = Array.from(new Set([phone, phoneSecondary].filter(Boolean)));
  const address = customer.address || '';
  const accountCode = customer.accountNumber || customer.externalCustomerCode || '';
  const hasCoordinates = Number.isFinite(Number(customer.geoLat)) && Number.isFinite(Number(customer.geoLng));

  const saveToContacts = async () => {
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (permission.status !== 'granted') { Alert.alert('الصلاحية مطلوبة', 'اسمح للتطبيق بالوصول إلى جهات الاتصال.'); return; }
      await Contacts.addContactAsync({
        contactType: Contacts.ContactTypes.Person,
        [Contacts.Fields.Name]: fullName,
        [Contacts.Fields.PhoneNumbers]: Array.from(new Set([phone, phoneSecondary, whatsapp].filter(Boolean)))
          .map((number, index) => ({ label: index === 0 ? 'الراقي - أساسي' : 'الراقي', number })),
      });
      Alert.alert('تم الحفظ', 'أضيف العميل إلى جهات اتصال الهاتف.');
    } catch (error: any) {
      Alert.alert('تعذر الحفظ', error?.message || 'تحقق من صلاحية جهات الاتصال.');
    }
  };

  const openContactPicker = async () => {
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (permission.status !== 'granted') { Alert.alert('الصلاحية مطلوبة', 'اسمح للتطبيق بقراءة جهات الاتصال.'); return; }
      try {
        const picked = await Contacts.presentContactPickerAsync();
        if (picked?.phoneNumbers?.length) {
          setDeviceContacts([picked]);
          setContactSearch('');
          setContactModal(true);
          return;
        }
        if (picked) return;
      } catch { /* some Android vendors do not expose a native picker */ }
      const result = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers], sort: Contacts.SortTypes.FirstName });
      setDeviceContacts(result.data.filter((contact) => contact.phoneNumbers?.length));
      setContactModal(true);
    } catch (error: any) {
      Alert.alert('تعذر فتح دفتر الهاتف', error?.message || 'تحقق من الصلاحيات.');
    }
  };

  const savePhoneField = async (number: string, field: 'phonePrimary' | 'phoneSecondary' | 'whatsapp') => {
    if (!number) return;
    await updateCustomerContactOffline(id, { [field]: number });
    await enqueueMutation(generateIdempotencyKey(), 'PATCH', `/mobile/customers/${id}/field-update`, { [field]: number });
    setContactModal(false);
    await loadLocal();
    Alert.alert('تم الحفظ محلياً', 'تم تحديث الرقم وسيُرسل إلى الخادم عند المزامنة.');
  };

  const chooseContactNumber = (number?: string | null) => {
    if (!number) return;
    Alert.alert('تحديد نوع الرقم', number, [
      { text: 'رقم أساسي', onPress: () => savePhoneField(number, 'phonePrimary') },
      { text: 'رقم إضافي', onPress: () => savePhoneField(number, 'phoneSecondary') },
      { text: 'رقم واتساب', onPress: () => savePhoneField(number, 'whatsapp') },
      { text: 'إلغاء', style: 'cancel' },
    ]);
  };

  const openPhoneEditor = () => {
    setPhoneDraft({ phonePrimary: phone, phoneSecondary, whatsapp: customer.whatsapp || '' });
    setPhoneEditorOpen(true);
  };

  const savePhoneEditor = async () => {
    const fields = {
      phonePrimary: phoneDraft.phonePrimary.trim(),
      phoneSecondary: phoneDraft.phoneSecondary.trim(),
      whatsapp: phoneDraft.whatsapp.trim(),
    };
    if (!fields.phonePrimary && !fields.phoneSecondary && !fields.whatsapp) {
      Alert.alert('أدخل رقمًا', 'أدخل رقم هاتف واحدًا على الأقل.');
      return;
    }
    await updateCustomerContactOffline(id, fields);
    await enqueueMutation(generateIdempotencyKey(), 'PATCH', `/mobile/customers/${id}/field-update`, fields);
    setPhoneEditorOpen(false);
    await loadLocal();
    Alert.alert('تم الحفظ محلياً', 'حُفظت أرقام العميل وستُزامن مع النظام لاحقًا.');
  };

  const openPhoneAction = (kind: 'call' | 'sms') => {
    const valid = availablePhones.map((number) => ({ number, links: contactLinks(number) })).filter((item) => item.links);
    const run = (item: typeof valid[number]) => openLink(kind === 'call' ? item.links!.tel : item.links!.sms, kind === 'call' ? 'لا يوجد تطبيق اتصال' : 'لا يوجد تطبيق رسائل');
    if (valid.length <= 1) { if (valid[0]) run(valid[0]); return; }
    Alert.alert(kind === 'call' ? 'اختر رقم الاتصال' : 'اختر رقم الرسالة', fullName, [
      ...valid.map((item) => ({ text: item.number, onPress: () => run(item) })),
      { text: 'إلغاء', style: 'cancel' as const },
    ]);
  };

  const sendTemplate = (template: MessageTemplate) => {
    if (!messageChannel) return;
    const channel = messageChannel;
    const targetLinks = channel === 'whatsapp' ? (whatsappLinks || links) : (links || secondaryLinks);
    if (!targetLinks) return;
    const primaryBalance = balances.find((item: any) => Math.abs(Number(item?.balance ?? item?.accountingBalance ?? 0)) > 0.001) || {};
    const amount = Math.abs(Number(primaryBalance.balance ?? primaryBalance.accountingBalance ?? 0));
    const body = renderMessageTemplate(template.body, {
      customerName: fullName,
      customerCode: accountCode || '—',
      balance: amount.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      currency: primaryBalance.currency || primaryBalance.currencyCode || '',
    });
    setMessageChannel(null);
    if (channel === 'whatsapp') {
      openLink(`${targetLinks.whatsapp}?text=${encodeURIComponent(body)}`, 'لا يوجد واتساب');
      return;
    }
    const smsTargets = availablePhones
      .map((number) => ({ number, links: contactLinks(number) }))
      .filter((item) => item.links);
    const sendSms = (target: typeof smsTargets[number]) => openLink(
      `${target.links!.sms}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(body)}`,
      'لا يوجد تطبيق رسائل',
    );
    if (smsTargets.length <= 1) {
      if (smsTargets[0]) sendSms(smsTargets[0]);
      return;
    }
    Alert.alert('اختر رقم الرسالة', fullName, [
      ...smsTargets.map((target) => ({ text: target.number, onPress: () => sendSms(target) })),
      { text: 'إلغاء', style: 'cancel' as const },
    ]);
  };

  const submitAssignmentRequest = async () => {
    const reason = assignmentReason.trim();
    if (reason.length < 5) {
      Alert.alert('السبب مطلوب', 'اكتب سببًا واضحًا لتغيير الإسناد (خمسة أحرف على الأقل).');
      return;
    }
    try {
      await enqueueMutation(
        generateIdempotencyKey(), 'POST', '/assignments/change-requests',
        { customerId: id, reason },
      );
      setAssignmentRequestOpen(false);
      setAssignmentReason('');
      Alert.alert('تم تسجيل الطلب', 'حُفظ الطلب وسيصل إلى المسؤول عند المزامنة. لن يتغير الإسناد قبل اعتماده.');
      triggerSync().catch(() => undefined);
    } catch (error: any) {
      Alert.alert('تعذر حفظ الطلب', error?.message || 'حاول مرة أخرى.');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.name}>{fullName}</Text>
        {!!accountCode && <Text style={styles.accountCode}>كود الحساب #{accountCode}</Text>}
        {!!phone && <Text style={styles.phone}>الأساسي: {phone}</Text>}
        {!!phoneSecondary && <Text style={styles.phone}>الإضافي: {phoneSecondary}</Text>}
        {!!customer.whatsapp && <Text style={styles.phone}>واتساب: {customer.whatsapp}</Text>}
        {!!address && <Text style={styles.address}>{address}</Text>}
      </View>

      {(availablePhones.length > 0 || whatsappLinks) && (
        <View style={styles.contactRow}>
          <ContactBtn label="اتصال" icon="call" color={colors.secondary} onPress={() => openPhoneAction('call')} />
          <ContactBtn label="رسالة" icon="chatbox" color={colors.primary} onPress={() => setMessageChannel('sms')} />
          <ContactBtn label="واتساب" icon="logo-whatsapp" color="#16875B" onPress={() => setMessageChannel('whatsapp')} />
        </View>
      )}
      <TouchableOpacity style={styles.saveContact} onPress={openPhoneEditor}><Text style={styles.saveContactText}>إضافة أو تعديل أرقام العميل</Text></TouchableOpacity>
      {availablePhones.length > 0 && <TouchableOpacity style={styles.saveContact} onPress={saveToContacts}><Text style={styles.saveContactText}>حفظ جميع الأرقام في جهات الاتصال</Text></TouchableOpacity>}
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
      <TouchableOpacity
        style={styles.setLocationBtn}
        onPress={() => navigation.navigate('CustomerLocationPicker', { customerId: id, geoLat: customer.geoLat, geoLng: customer.geoLng })}
      >
        <Text style={styles.setLocationText}>{hasCoordinates ? 'تعديل موقع العميل على الخريطة' : 'إضافة موقع العميل من الخريطة'}</Text>
      </TouchableOpacity>

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
                <Text style={[styles.balanceValue, operational < 0 && styles.creditBalance]}>{Number.isFinite(operational) ? Math.abs(operational).toLocaleString('en-US') : '0'}</Text>
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
        <ActionBtn title="متابعة" color={colors.gold} textColor={colors.primary} onPress={() => navigation.navigate('NewFollowup', { customerId: id, customerName: fullName })} />
        <ActionBtn title="وعد سداد" color={colors.primary} onPress={() => navigation.navigate('NewPromise', { customerId: id, customerName: fullName })} />
        <ActionBtn title="تحصيل" color={colors.danger} onPress={() => navigation.navigate('NewCollection', { customerId: id, customerName: fullName })} />
      </View>
      <TouchableOpacity style={styles.assignmentRequestBtn} onPress={() => setAssignmentRequestOpen(true)}>
        <Ionicons name="swap-horizontal-outline" size={18} color={colors.primary} />
        <Text style={styles.assignmentRequestText}>طلب تغيير الإسناد</Text>
      </TouchableOpacity>

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
            data={deviceContacts.flatMap((contact) => (contact.phoneNumbers || []).map((phoneItem, index) => ({
              key: `${contact.id || contact.name}-${phoneItem.number}-${index}`,
              name: contact.name || 'بدون اسم',
              number: phoneItem.number || '',
              label: phoneItem.label || '',
            }))).filter((item) => !contactSearch || `${item.name} ${item.number}`.toLowerCase().includes(contactSearch.toLowerCase()))}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => <TouchableOpacity style={styles.deviceContact} onPress={() => chooseContactNumber(item.number)}><Text style={styles.deviceContactName}>{item.name}</Text><Text style={styles.deviceContactPhone}>{item.number}{item.label ? ` · ${item.label}` : ''}</Text></TouchableOpacity>}
          />
        </View>
      </Modal>
      <Modal visible={phoneEditorOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setPhoneEditorOpen(false)}>
        <KeyboardAvoidingView style={styles.assignmentKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.templateShade, { paddingBottom: modalKeyboardHeight }]}><View style={[styles.phoneEditorSheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.modalHead}><TouchableOpacity onPress={() => setPhoneEditorOpen(false)}><Text style={styles.modalClose}>إغلاق</Text></TouchableOpacity><Text style={styles.modalTitle}>أرقام العميل</Text></View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.phoneEditorContent}>
              <PhoneInput label="الرقم الأساسي" value={phoneDraft.phonePrimary} onChangeText={(value) => setPhoneDraft((current) => ({ ...current, phonePrimary: value }))} />
              <PhoneInput label="الرقم الإضافي" value={phoneDraft.phoneSecondary} onChangeText={(value) => setPhoneDraft((current) => ({ ...current, phoneSecondary: value }))} />
              <PhoneInput label="رقم واتساب" value={phoneDraft.whatsapp} onChangeText={(value) => setPhoneDraft((current) => ({ ...current, whatsapp: value }))} />
              <TouchableOpacity style={styles.assignmentSubmit} onPress={savePhoneEditor}><Text style={styles.assignmentSubmitText}>حفظ الأرقام</Text></TouchableOpacity>
              <TouchableOpacity style={styles.importContact} onPress={() => { setPhoneEditorOpen(false); openContactPicker(); }}><Text style={styles.importContactText}>اختيار رقم من دفتر الهاتف</Text></TouchableOpacity>
            </ScrollView>
          </View></View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={!!messageChannel} transparent animationType="slide" onRequestClose={() => setMessageChannel(null)}>
        <View style={styles.templateShade}><View style={styles.templateSheet}>
          <View style={styles.modalHead}><TouchableOpacity onPress={() => setMessageChannel(null)}><Text style={styles.modalClose}>إغلاق</Text></TouchableOpacity><Text style={styles.modalTitle}>اختر قالب الرسالة</Text></View>
          <FlatList
            data={templates.filter((template) => template.active && (template.channel === 'both' || template.channel === messageChannel))}
            keyExtractor={(template) => template.id}
            renderItem={({ item }) => <TouchableOpacity style={styles.templateItem} onPress={() => sendTemplate(item)}><Text style={styles.templateName}>{item.name}</Text><Text style={styles.templateBody} numberOfLines={2}>{item.body}</Text></TouchableOpacity>}
            ListFooterComponent={<TouchableOpacity style={styles.editTemplates} onPress={() => { setMessageChannel(null); navigation.navigate('MessageTemplates'); }}><Text style={styles.editTemplatesText}>تعديل القوالب</Text></TouchableOpacity>}
          />
        </View></View>
      </Modal>
      <Modal visible={assignmentRequestOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setAssignmentRequestOpen(false)}>
        <KeyboardAvoidingView style={styles.assignmentKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.templateShade, { paddingBottom: modalKeyboardHeight }]}><View style={[styles.assignmentSheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.assignmentSheetHead}>
              <TouchableOpacity onPress={() => setAssignmentRequestOpen(false)}><Text style={styles.modalClose}>إغلاق</Text></TouchableOpacity>
              <Text style={styles.assignmentSheetTitle}>طلب تغيير إسناد</Text>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              contentContainerStyle={styles.assignmentContent}
            >
              <Text style={styles.assignmentHelp}>سيصل الطلب إلى مدير النظام أو مدير المديونية أو المحاسب المخوّل، ولن يتغير الإسناد إلا بعد المراجعة.</Text>
              <TextInput
                style={styles.assignmentReason}
                value={assignmentReason}
                onChangeText={setAssignmentReason}
                placeholder="اكتب سبب طلب التغيير..."
                placeholderTextColor={colors.muted}
                multiline
                maxLength={500}
                textAlign="right"
              />
              <TouchableOpacity style={styles.assignmentSubmit} onPress={submitAssignmentRequest}>
                <Text style={styles.assignmentSubmitText}>إرسال الطلب</Text>
              </TouchableOpacity>
            </ScrollView>
          </View></View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

function ContactBtn({ label, icon, color, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.contactBtn, { backgroundColor: color }]} onPress={onPress}>
      <Ionicons name={icon} size={18} color="#fff" /><Text style={styles.contactBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function PhoneInput({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) {
  return <View><Text style={styles.phoneInputLabel}>{label}</Text><TextInput style={styles.phoneInput} value={value} onChangeText={onChangeText} keyboardType="phone-pad" textAlign="right" placeholder="أدخل رقم الهاتف" placeholderTextColor={colors.muted} /></View>;
}

function ActionBtn({ title, color, textColor = '#fff', onPress }: { title: string; color: string; textColor?: string; onPress: () => void }) {
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
      <Text style={[styles.actionText, { color: textColor }]}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  error: { color: colors.danger, fontSize: 16, textAlign: 'center' },
  backBtn: { marginTop: 16, padding: 12 },
  backText: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  header: { backgroundColor: colors.primary, padding: 20 },
  name: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  phone: { fontSize: 16, color: '#fff', marginTop: 4, opacity: 0.9 },
  accountCode: { fontSize: 12, color: colors.gold, marginTop: 5, fontWeight: '800' },
  address: { fontSize: 14, color: '#fff', marginTop: 4, opacity: 0.7 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.primary, padding: 16, paddingBottom: 8, textAlign: 'right' },
  emptyText: { textAlign: 'center', color: '#999', padding: 16 },
  balanceCard: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  balanceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balanceSubRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.line },
  balanceSubLabel: { fontSize: 12, color: '#999' },
  balanceSubValue: { fontSize: 12, color: '#666' },
  balanceCurrency: { fontSize: 16, color: '#333', fontWeight: '500' },
  balanceValue: { fontSize: 18, color: colors.danger, fontWeight: 'bold' },
  creditBalance: { color: colors.success },
  contactRow: { flexDirection: 'row', padding: 12, gap: 8 },
  contactBtn: { flex: 1, padding: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row-reverse', gap: 5 },
  contactBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  saveContact: { marginHorizontal: 16, marginBottom: 6, padding: 11, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center' },
  saveContactText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  importContact: { marginHorizontal: 16, marginBottom: 8, padding: 11, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary, alignItems: 'center' },
  importContactText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  locationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  locationLabel: { fontSize: 14, fontWeight: '600', color: '#333' },
  locationBtn: { backgroundColor: colors.primarySoft, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.line },
  locationBtnText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  setLocationBtn: { marginHorizontal: 16, marginBottom: 10, padding: 12, borderRadius: radius.sm, backgroundColor: colors.goldSoft, alignItems: 'center' },
  setLocationText: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  actions: { flexDirection: 'row', padding: 16, gap: 8 },
  assignmentRequestBtn: { marginHorizontal: 16, marginBottom: 10, padding: 13, borderRadius: radius.md, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.goldSoft, flexDirection: 'row-reverse', justifyContent: 'center', alignItems: 'center', gap: 7 },
  assignmentRequestText: { color: colors.primary, fontSize: 14, fontWeight: '900' },
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
  templateShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,28,25,.55)' },
  templateSheet: { maxHeight: '70%', backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  phoneEditorSheet: { maxHeight: '88%', backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  phoneEditorContent: { paddingVertical: 14 },
  phoneInputLabel: { color: colors.ink, fontSize: 13, fontWeight: '800', textAlign: 'right', marginHorizontal: 18, marginTop: 8, marginBottom: 5 },
  phoneInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, marginHorizontal: 18, padding: 12, color: colors.ink },
  assignmentKeyboard: { flex: 1 },
  assignmentSheet: { maxHeight: '92%', backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  assignmentContent: { paddingBottom: 4 },
  assignmentSheetHead: { backgroundColor: colors.primary, padding: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  assignmentSheetTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  assignmentHelp: { color: colors.muted, fontSize: 12, lineHeight: 19, textAlign: 'right', marginHorizontal: 18, marginTop: 16 },
  assignmentReason: { minHeight: 110, maxHeight: 170, margin: 18, marginBottom: 10, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', color: colors.ink, textAlignVertical: 'top' },
  assignmentSubmit: { marginHorizontal: 18, padding: 14, borderRadius: radius.md, backgroundColor: colors.gold, alignItems: 'center' },
  assignmentSubmitText: { color: colors.primary, fontWeight: '900', fontSize: 15 },
  templateItem: { marginHorizontal: 14, marginTop: 10, padding: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md },
  templateName: { color: colors.ink, fontSize: 14, fontWeight: '900', textAlign: 'right' }, templateBody: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 5, textAlign: 'right' },
  editTemplates: { margin: 14, backgroundColor: colors.goldSoft, padding: 13, borderRadius: radius.md, alignItems: 'center' }, editTemplatesText: { color: colors.primary, fontWeight: '900' },
});
