import {parseGeoPoint} from '../utils/geo-point';
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking, Platform, Modal, FlatList, TextInput, KeyboardAvoidingView, Keyboard } from 'react-native';
import { enqueueMutation, cancelContactAttemptLocal, getCustomerOffline360, updateCustomerContactOffline } from '../db/database';
import { useFocusEffect } from '@react-navigation/native';
import Loading from '../components/loading';
import AccountStatementDownload from '../components/account-statement-download';
import { parseJsonField } from '../utils/errors';
import { contactLinks, uniqueContactNumbers } from '../utils/contact';
import { useSync } from '../store/sync-context';
// SDK 57 exposes the imperative contact APIs through the legacy entry point.
import * as Contacts from 'expo-contacts/legacy';
import { colors, radius } from '../theme';
import { generateIdempotencyKey } from '../utils/constants';
import { Ionicons } from '@expo/vector-icons';
import { loadMessageTemplates, MessageChannel, MessageTemplate, renderMessageTemplate } from '../utils/message-templates';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReceiptPreview, { ReceiptReference } from '../components/receipt-preview';
import { useAuth } from '../store/auth-context';
import { canUseMobileFeature } from '../utils/mobile-permissions';
import { reminderBalanceText } from '../utils/reminder-balances';

async function openLink(url: string, fallbackMsg: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) { await Linking.openURL(url); return true; }
    else { Alert.alert('تنبيه', fallbackMsg); }
  } catch { Alert.alert('خطأ', 'تعذر فتح التطبيق'); }
  return false;
}

export default function Customer360Screen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const id = route?.params?.id;
  const routeCustomer = route?.params?.customer;
  const { triggerSync } = useSync();
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const deliveryDirectory = permissions.includes('mobile.delivery.customers.view_all_no_balance');
  const canViewLocation = deliveryDirectory
    || canUseMobileFeature(permissions, 'mobile.location.view', 'customers.read');
  const canUpdateLocation = deliveryDirectory
    || canUseMobileFeature(permissions, 'mobile.location.update', 'followups.create');
  const canCreateFollowup = canUseMobileFeature(permissions, 'mobile.followups.create', 'followups.create');
  const canCreatePromise = canUseMobileFeature(permissions, 'mobile.promises.create', 'promises.create');
  const canCreateCollection = canUseMobileFeature(permissions, 'mobile.collections.create', 'collections.create');
  const canCreateTask = canUseMobileFeature(permissions, 'mobile.tasks.create', 'tasks.manage');
  const canRequestAssignment = canUseMobileFeature(permissions, 'mobile.assignment_change.request', 'tasks.manage');
  const canRequestAdjustment = canUseMobileFeature(permissions, 'mobile.financial_adjustments.request', 'collections.create');
  const canViewCollectionMedia = canUseMobileFeature(permissions, 'mobile.receipts.view', 'collections.create')
    || canViewLocation;
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
  const [financialRequestOpen, setFinancialRequestOpen] = React.useState(false);
  const [financialRequestType, setFinancialRequestType] = React.useState<'discount' | 'settlement'>('discount');
  const [financialAmount, setFinancialAmount] = React.useState('');
  const [financialReason, setFinancialReason] = React.useState('');
  const [statementRequest, setStatementRequest] = React.useState(0);
  const [statementReminder, setStatementReminder] = React.useState('');
  const [statementCustomerId, setStatementCustomerId] = React.useState('');
  const [receiptPreview, setReceiptPreview] = React.useState<ReceiptReference | null>(null);
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
  const groupBalances = parseJsonField<any[]>(customer.groupBalances, Array.isArray(customer.groupBalances) ? customer.groupBalances : []);
  const childBalances = parseJsonField<any[]>(customer.childBalances, Array.isArray(customer.childBalances) ? customer.childBalances : []);
  const timeline = Array.isArray(customer.timeline) ? customer.timeline : [];
  const fullName = customer.fullName || customer.name || 'عميل';
  const phone = customer.phonePrimary || customer.phone || '';
  const phoneSecondary = customer.phoneSecondary || '';
  const whatsapp = customer.whatsapp || '';
  const availablePhones = uniqueContactNumbers([phone, phoneSecondary, whatsapp]);
  const address = customer.address || '';
  const accountCode = customer.externalCustomerCode || customer.accountNumber || '';
  const hasCoordinates = !!parseGeoPoint(customer.geoLat, customer.geoLng);
  const recentCollections = Array.isArray(customer.recentCollections) ? customer.recentCollections : [];

  const saveToContacts = async () => {
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (permission.status !== 'granted') { Alert.alert('الصلاحية مطلوبة', 'اسمح للتطبيق بالوصول إلى جهات الاتصال.'); return; }
      const contactName = String(fullName || accountCode || 'عميل البناء الراقي').trim();
      const phoneNumbers = availablePhones.map((number, index) => ({
        label: index === 0 ? 'الراقي - أساسي' : 'الراقي',
        number: String(number).trim(),
      }));
      const sameDigits = (left: unknown, right: unknown) => {
        const normalize = (value: unknown) => String(value || '').replace(/\D/g, '').replace(/^00/, '');
        const a = normalize(left); const b = normalize(right);
        return Boolean(a && b && (a === b || a.endsWith(b) || b.endsWith(a)));
      };
      const existing = await Contacts.getContactsAsync({
        name: contactName,
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
      });
      const matched = existing.data.find((contact) =>
        contact.name === contactName
        || (contact.phoneNumbers || []).some((stored) => phoneNumbers.some((next) => sameDigits(stored.number, next.number))));
      const contact = {
        contactType: Contacts.ContactTypes.Person,
        name: contactName,
        firstName: contactName,
        phoneNumbers,
      };
      const contactId = matched?.id
        ? await Contacts.updateContactAsync({ id: matched.id, ...contact })
        : await Contacts.addContactAsync(contact);
      if (!contactId) throw new Error('لم يُرجع الهاتف رقم جهة الاتصال');
      Alert.alert('تم الحفظ', matched ? 'تم تحديث اسم العميل وأرقامه في جهات الاتصال.' : 'أضيف اسم العميل وجميع أرقامه إلى جهات الاتصال.');
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

  const openContact = async (url:string, fallback:string, channel:'call'|'sms'|'whatsapp') => {
    const occurredAt=new Date().toISOString();
    const operationId=generateIdempotencyKey();
    try {
      if(!await Linking.canOpenURL(url)){Alert.alert('تنبيه',fallback);return;}
      await enqueueMutation(operationId,'POST','/followups/contact-attempts',{operationId,customerId:id,channel,occurredAt});
      try{await Linking.openURL(url);}catch{await cancelContactAttemptLocal(operationId);Alert.alert('خطأ','تعذر فتح التطبيق');return;}
      void triggerSync();
    } catch { Alert.alert('تنبيه','تعذر حفظ محاولة التواصل؛ أعد المحاولة أو سجّل المتابعة يدويًا.'); }
  };
  const openPhoneAction = (kind: 'call' | 'sms') => {
    const valid = availablePhones.map((number) => ({ number, links: contactLinks(number) })).filter((item) => item.links);
    const run = (item: typeof valid[number]) => openContact(kind === 'call' ? item.links!.tel : item.links!.sms, kind === 'call' ? 'لا يوجد تطبيق اتصال' : 'لا يوجد تطبيق رسائل',kind);
    if (valid.length <= 1) { if (valid[0]) run(valid[0]); return; }
    Alert.alert(kind === 'call' ? 'اختر رقم الاتصال' : 'اختر رقم الرسالة', fullName, [
      ...valid.map((item) => ({ text: item.number, onPress: () => run(item) })),
      { text: 'إلغاء', style: 'cancel' as const },
    ]);
  };

  const sendTemplate = (template: MessageTemplate) => {
    if (!messageChannel) return;
    const channel = messageChannel;
    const hasAccountGroup = childBalances.some((item: any) => Number(item?.balance ?? 0) > 0.001);
    const sourceBalances = hasAccountGroup ? groupBalances : balances;
    const debtText = reminderBalanceText(sourceBalances);
    const rendered = renderMessageTemplate(template.body, {
      customerName: fullName,
      customerCode: accountCode || '—',
      balance: debtText.balance,
      currency: debtText.currency,
    });
    const formatTotals = (items: any[]) => reminderBalanceText(items).summary;
    const body = hasAccountGroup
      ? `${rendered}\n\nإجمالي الحساب الرئيسي والفرعي: ${formatTotals(groupBalances)}.\nإجمالي الحسابات الفرعية: ${formatTotals(childBalances)}.`
      : rendered;
    setMessageChannel(null);
    if (template.id === 'account-statement') {
      if (!permissions.includes('customers.read') || !permissions.includes('balances.read')) {
        Alert.alert('صلاحية مطلوبة', 'تنزيل كشف الحساب يحتاج صلاحية قراءة العملاء والأرصدة.');
        return;
      }
      setStatementReminder(body);
      setStatementCustomerId(id);
      setStatementRequest(value => value + 1);
      return;
    }
    if (channel === 'whatsapp') {
      const whatsappTargets = uniqueContactNumbers([whatsapp, phone, phoneSecondary])
        .map((number) => ({ number, links: contactLinks(number) }))
        .filter((item) => item.links);
      const sendWhatsapp = (target: typeof whatsappTargets[number]) => openContact(
        `${target.links!.whatsapp}?text=${encodeURIComponent(body)}`,
        'لا يوجد واتساب','whatsapp',
      );
      if (whatsappTargets.length <= 1) {
        if (whatsappTargets[0]) sendWhatsapp(whatsappTargets[0]);
        return;
      }
      Alert.alert('اختر رقم واتساب', fullName, [
        ...whatsappTargets.map((target) => ({ text: target.number, onPress: () => sendWhatsapp(target) })),
        { text: 'إلغاء', style: 'cancel' as const },
      ]);
      return;
    }
    const smsTargets = availablePhones
      .map((number) => ({ number, links: contactLinks(number) }))
      .filter((item) => item.links);
    const sendSms = (target: typeof smsTargets[number]) => openContact(
      `${target.links!.sms}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(body)}`,
      'لا يوجد تطبيق رسائل','sms',
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

  const openFinancialRequest = () => {
    const debtor = balances.find((balance: any) =>
      Number(balance?.operationalBalance ?? balance?.balance ?? balance?.accountingBalance ?? 0) > 0.001);
    if (!debtor) {
      Alert.alert('لا يوجد رصيد مدين', 'لا يمكن تقديم طلب خصم أو تصفية لحساب صفري أو دائن.');
      return;
    }
    setFinancialAmount('');
    setFinancialReason('');
    setFinancialRequestType('discount');
    setFinancialRequestOpen(true);
  };

  const submitFinancialRequest = async () => {
    const debtor = balances.find((balance: any) =>
      Number(balance?.operationalBalance ?? balance?.balance ?? balance?.accountingBalance ?? 0) > 0.001);
    const currencyCode = debtor?.currency || debtor?.currencyCode;
    const amount = Number(financialAmount.replace(/,/g, ''));
    if (!currencyCode || !Number.isFinite(amount) || amount <= 0) {
      Alert.alert('المبلغ مطلوب', 'أدخل مبلغًا صحيحًا أكبر من صفر.');
      return;
    }
    if (financialReason.trim().length < 5) {
      Alert.alert('السبب مطلوب', 'اكتب سببًا واضحًا للطلب، خمسة أحرف على الأقل.');
      return;
    }
    try {
      await enqueueMutation(generateIdempotencyKey(), 'POST', `/customers/${id}/financial-adjustment-requests`, {
        requestType: financialRequestType,
        currencyCode,
        requestedAmount: amount,
        reason: financialReason.trim(),
      });
      setFinancialRequestOpen(false);
      Alert.alert('تم حفظ الطلب', 'سيصل الطلب إلى الإدارة المالية عند المزامنة، ولن يتغير الرصيد قبل الاعتماد.');
      triggerSync().catch(() => undefined);
    } catch (error: any) {
      Alert.alert('تعذر حفظ الطلب', error?.message || 'حاول مرة أخرى.');
    }
  };

  const previewCollectionReceipt = async (collection: any) => {
    const attachment = parseJsonField<any>(collection.receiptAttachment, collection.receiptAttachment || null);
    if (!attachment?.id) return;
    setReceiptPreview({
      id: String(attachment.id),
      name: attachment.fileName || 'إيصال التحصيل',
    });
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

      {availablePhones.length > 0 && (
        <View style={styles.contactRow}>
          <ContactBtn label="اتصال" icon="call" color={colors.secondary} onPress={() => openPhoneAction('call')} />
          <ContactBtn label="رسالة" icon="chatbox" color={colors.primary} onPress={() => setMessageChannel('sms')} />
          <ContactBtn label="واتساب" icon="logo-whatsapp" color="#16875B" onPress={() => setMessageChannel('whatsapp')} />
        </View>
      )}
      {availablePhones.length > 0 && <Text style={{color:colors.muted,textAlign:'right',paddingHorizontal:16,fontSize:12}}>بعد فتح الاتصال أو الرسالة لديك 10 دقائق لتسجيل المتابعة أو المهمة أو الوعد؛ وإلا تُسجَّل محاولة تواصل ومهمة بعد 7 أيام تلقائيًا.</Text>}
      <TouchableOpacity style={styles.saveContact} onPress={openPhoneEditor}><Text style={styles.saveContactText}>إضافة أو تعديل أرقام العميل</Text></TouchableOpacity>
      {availablePhones.length > 0 && <TouchableOpacity style={styles.saveContact} onPress={saveToContacts}><Text style={styles.saveContactText}>حفظ جميع الأرقام في جهات الاتصال</Text></TouchableOpacity>}
      <TouchableOpacity style={styles.importContact} onPress={openContactPicker}><Text style={styles.importContactText}>اختيار رقم العميل من دفتر الهاتف</Text></TouchableOpacity>

      {canViewLocation && <View style={styles.locationRow}>
        <Text style={styles.locationLabel}>الموقع</Text>
        <TouchableOpacity
          style={styles.locationBtn}
          onPress={() => {
            if (hasCoordinates || address) {
              const query = hasCoordinates ? `${customer.geoLat},${customer.geoLng}` : address;
              openLink(
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
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
      </View>}
      {canUpdateLocation && <TouchableOpacity
        style={styles.setLocationBtn}
        onPress={() => navigation.navigate('CustomerLocationPicker', { customerId: id, geoLat: customer.geoLat, geoLng: customer.geoLng })}
      >
        <Text style={styles.setLocationText}>{hasCoordinates ? 'تعديل موقع العميل على الخريطة' : 'إضافة موقع العميل من الخريطة'}</Text>
      </TouchableOpacity>}

      {!customer.balanceHidden && <>
      {permissions.includes('customers.read') && permissions.includes('balances.read') && <AccountStatementDownload key={id} customerId={id} customerName={fullName} customerCode={accountCode} phones={[whatsapp, phone, phoneSecondary]} reminder={statementCustomerId === id ? statementReminder : ''} openRequest={statementCustomerId === id ? statementRequest : 0} />}
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
                <View style={styles.balanceDirection}><Text style={[styles.balanceValue, operational < 0 && styles.creditBalance]}>{Number.isFinite(operational) ? Math.abs(operational).toLocaleString('en-US') : '0'}</Text><Text style={[styles.balanceDirectionLabel, operational < 0 && styles.creditBalance]}>{operational < 0 ? 'دائن · له' : 'مدين · عليه'}</Text></View>
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
      </>}

      <View style={styles.actions}>
        {canCreateFollowup && <ActionBtn title="متابعة" color={colors.gold} textColor={colors.primary} onPress={() => navigation.navigate('NewFollowup', { customerId: id, customerName: fullName })} />}
        {canCreatePromise && <ActionBtn title="وعد سداد" color={colors.primary} onPress={() => navigation.navigate('NewPromise', { customerId: id, customerName: fullName })} />}
        {canCreateCollection && <ActionBtn title="تحصيل" color={colors.danger} onPress={() => navigation.navigate('NewCollection', { kind: 'receipt', customerId: id, customerName: fullName, customerCode: customer.externalCustomerCode, customerBalances: balances })} />}
        {canCreateTask && <ActionBtn title="مهمة" color={colors.secondary} onPress={() => navigation.navigate('NewTask', { customerId: id, customerName: fullName })} />}
      </View>
      <View style={styles.requestActionsRow}>
        {canRequestAssignment && <TouchableOpacity style={[styles.assignmentRequestBtn, styles.requestActionHalf]} onPress={() => setAssignmentRequestOpen(true)}>
          <Ionicons name="swap-horizontal-outline" size={18} color={colors.primary} />
          <Text style={styles.assignmentRequestText}>طلب تغيير الإسناد</Text>
        </TouchableOpacity>}
        {canRequestAdjustment && <TouchableOpacity style={[styles.assignmentRequestBtn, styles.requestActionHalf]} onPress={openFinancialRequest}>
          <Ionicons name="receipt-outline" size={18} color={colors.primary} />
          <Text style={styles.assignmentRequestText}>طلب خصم وتصفية</Text>
        </TouchableOpacity>}
      </View>

      {canViewCollectionMedia && recentCollections.some((collection: any) => collection.receiptAttachment || collection.location) && (
        <View style={styles.collectionMediaCard}>
          <Text style={styles.sectionTitle}>الإيصالات ومواقع التحصيل</Text>
          {recentCollections.filter((collection: any) => collection.receiptAttachment || collection.location).slice(0, 8).map((collection: any) => {
            const attachment = parseJsonField<any>(collection.receiptAttachment, collection.receiptAttachment || null);
            const point = parseJsonField<any>(collection.location, collection.location || null);
            return (
              <View key={collection.id} style={styles.collectionMediaRow}>
                <Text style={styles.collectionMediaLabel}>{Number(collection.amount || 0).toLocaleString('en-US')} {collection.currencyCode || ''}</Text>
                <View style={styles.collectionMediaActions}>
                  {attachment?.id && <TouchableOpacity style={styles.mediaMiniBtn} onPress={() => previewCollectionReceipt(collection)}><Text style={styles.mediaMiniText}>معاينة الإيصال</Text></TouchableOpacity>}
                  {point?.latitude && point?.longitude && <TouchableOpacity style={styles.mediaMiniBtn} onPress={() => openLink(`https://www.google.com/maps?q=${point.latitude},${point.longitude}`, 'تعذر فتح الخريطة')}><Text style={styles.mediaMiniText}>فتح الموقع</Text></TouchableOpacity>}
                </View>
              </View>
            );
          })}
        </View>
      )}

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
      <Modal visible={financialRequestOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setFinancialRequestOpen(false)}>
        <KeyboardAvoidingView style={styles.assignmentKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.templateShade, { paddingBottom: modalKeyboardHeight }]}><View style={[styles.assignmentSheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.assignmentSheetHead}>
              <TouchableOpacity onPress={() => setFinancialRequestOpen(false)}><Text style={styles.modalClose}>إغلاق</Text></TouchableOpacity>
              <Text style={styles.assignmentSheetTitle}>طلب خصم أو تصفية</Text>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.assignmentContent}>
              <Text style={styles.assignmentHelp}>الطلب للمراجعة فقط ولا يغيّر رصيد العميل تلقائيًا.</Text>
              <View style={styles.requestTypeRow}>
                {(['discount', 'settlement'] as const).map((type) => (
                  <TouchableOpacity key={type} style={[styles.requestTypeBtn, financialRequestType === type && styles.requestTypeBtnActive]} onPress={() => setFinancialRequestType(type)}>
                    <Text style={[styles.requestTypeText, financialRequestType === type && styles.requestTypeTextActive]}>{type === 'discount' ? 'خصم' : 'تصفية'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput style={styles.financialAmountInput} value={financialAmount} onChangeText={setFinancialAmount} keyboardType="decimal-pad" textAlign="right" placeholder="المبلغ المطلوب" placeholderTextColor={colors.muted} />
              <TextInput style={styles.assignmentReason} value={financialReason} onChangeText={setFinancialReason} multiline maxLength={500} textAlign="right" placeholder="سبب الطلب..." placeholderTextColor={colors.muted} />
              <TouchableOpacity style={styles.assignmentSubmit} onPress={submitFinancialRequest}><Text style={styles.assignmentSubmitText}>إرسال الطلب</Text></TouchableOpacity>
            </ScrollView>
          </View></View>
        </KeyboardAvoidingView>
      </Modal>
      <ReceiptPreview receipt={receiptPreview} onClose={() => setReceiptPreview(null)} />
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
  error: { fontFamily: 'TajawalRegular', color: colors.danger, fontSize: 16, textAlign: 'center' },
  backBtn: { marginTop: 16, padding: 12 },
  backText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 16, fontWeight: '700' },
  header: { backgroundColor: colors.primary, padding: 20 },
  name: { fontFamily: 'TajawalBold', fontSize: 23, fontWeight: 'bold', color: '#fff' },
  phone: { fontFamily: 'TajawalRegular', fontSize: 16, color: '#fff', marginTop: 4, opacity: 0.9 },
  accountCode: { fontFamily: 'TajawalBold', fontSize: 13, color: colors.gold, marginTop: 5, fontWeight: '800' },
  address: { fontFamily: 'TajawalRegular', fontSize: 15, color: '#fff', marginTop: 4, opacity: 0.7 },
  sectionTitle: { fontFamily: 'TajawalBold', fontSize: 18, fontWeight: '800', color: colors.primary, padding: 16, paddingBottom: 8, textAlign: 'right' },
  emptyText: { textAlign: 'center', color: '#999', padding: 16 },
  balanceCard: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  balanceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balanceSubRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.line },
  balanceSubLabel: { fontFamily: 'TajawalRegular', fontSize: 13, color: '#999' },
  balanceSubValue: { fontFamily: 'TajawalRegular', fontSize: 13, color: '#666' },
  balanceCurrency: { fontFamily: 'TajawalMedium', fontSize: 16, color: '#333', fontWeight: '500' },
  balanceValue: { fontFamily: 'TajawalBold', fontSize: 18, color: colors.danger, fontWeight: 'bold' },
  balanceDirection:{alignItems:'flex-start'},balanceDirectionLabel:{ fontFamily: 'TajawalBold',color:colors.danger,fontSize:13,fontWeight:'800',marginTop:1},
  creditBalance: { color: colors.success },
  contactRow: { flexDirection: 'row', padding: 12, gap: 8 },
  contactBtn: { flex: 1, padding: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row-reverse', gap: 5 },
  contactBtnText: { fontFamily: 'TajawalMedium', color: '#fff', fontSize: 14, fontWeight: '600' },
  saveContact: { marginHorizontal: 16, marginBottom: 6, padding: 11, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center' },
  saveContactText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 13, fontWeight: '800' },
  importContact: { marginHorizontal: 16, marginBottom: 8, padding: 11, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary, alignItems: 'center' },
  importContactText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 13, fontWeight: '800' },
  locationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  locationLabel: { fontFamily: 'TajawalMedium', fontSize: 15, fontWeight: '600', color: '#333' },
  locationBtn: { backgroundColor: colors.primarySoft, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.line },
  locationBtnText: { fontFamily: 'TajawalMedium', fontSize: 15, color: colors.primary, fontWeight: '600' },
  setLocationBtn: { marginHorizontal: 16, marginBottom: 10, padding: 12, borderRadius: radius.sm, backgroundColor: colors.goldSoft, alignItems: 'center' },
  setLocationText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 14, fontWeight: '900' },
  actions: { flexDirection: 'row', padding: 16, gap: 8 },
  assignmentRequestBtn: { marginHorizontal: 16, marginBottom: 10, padding: 13, borderRadius: radius.md, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.goldSoft, flexDirection: 'row-reverse', justifyContent: 'center', alignItems: 'center', gap: 7 },
  requestActionsRow: { flexDirection: 'row-reverse', marginHorizontal: 10, gap: 8 },
  requestActionHalf: { flex: 1, marginHorizontal: 0 },
  assignmentRequestText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 15, fontWeight: '900' },
  actionBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  actionText: { fontFamily: 'TajawalMedium', color: '#fff', fontSize: 15, fontWeight: '600' },
  timelineItem: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 4, padding: 12, borderRadius: 8 },
  timelineTitle: { fontFamily: 'TajawalRegular', fontSize: 15, color: '#333' },
  timelineDate: { fontFamily: 'TajawalRegular', fontSize: 13, color: '#999', marginTop: 2 },
  contactModal: { flex: 1, backgroundColor: colors.background, paddingTop: 45 },
  modalHead: { backgroundColor: colors.primary, padding: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontFamily: 'TajawalBold', color: '#fff', fontSize: 18, fontWeight: '900' }, modalClose: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.gold, fontWeight: '800' },
  contactSearch: { margin: 14, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 13, color: colors.ink },
  deviceContact: { marginHorizontal: 14, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: '#fff' },
  deviceContactName: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 16, fontWeight: '800', textAlign: 'right' }, deviceContactPhone: { color: colors.muted, marginTop: 3, textAlign: 'right' },
  templateShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,28,25,.55)' },
  templateSheet: { maxHeight: '70%', backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  phoneEditorSheet: { maxHeight: '88%', backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  phoneEditorContent: { paddingVertical: 14 },
  phoneInputLabel: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 14, fontWeight: '800', textAlign: 'right', marginHorizontal: 18, marginTop: 8, marginBottom: 5 },
  phoneInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, marginHorizontal: 18, padding: 12, color: colors.ink },
  assignmentKeyboard: { flex: 1 },
  assignmentSheet: { maxHeight: '92%', backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  assignmentContent: { paddingBottom: 4 },
  assignmentSheetHead: { backgroundColor: colors.primary, padding: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  assignmentSheetTitle: { fontFamily: 'TajawalBold', color: '#fff', fontSize: 18, fontWeight: '900' },
  assignmentHelp: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'right', marginHorizontal: 18, marginTop: 16 },
  assignmentReason: { minHeight: 110, maxHeight: 170, margin: 18, marginBottom: 10, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', color: colors.ink, textAlignVertical: 'top' },
  assignmentSubmit: { marginHorizontal: 18, padding: 14, borderRadius: radius.md, backgroundColor: colors.gold, alignItems: 'center' },
  assignmentSubmitText: { fontFamily: 'TajawalBold', color: colors.primary, fontWeight: '900', fontSize: 16 },
  requestTypeRow: { flexDirection: 'row-reverse', gap: 10, marginHorizontal: 18, marginTop: 16 },
  requestTypeBtn: { flex: 1, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', backgroundColor: '#fff' },
  requestTypeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  requestTypeText: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.ink, fontWeight: '800' },
  requestTypeTextActive: { color: '#fff' },
  financialAmountInput: { fontFamily: 'TajawalBold', marginHorizontal: 18, marginTop: 14, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', color: colors.ink, fontSize: 18, fontWeight: '800' },
  collectionMediaCard: { marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: radius.md, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line },
  collectionMediaRow: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 8 },
  collectionMediaLabel: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.ink, fontWeight: '800', textAlign: 'right' },
  collectionMediaActions: { flexDirection: 'row-reverse', gap: 8 },
  mediaMiniBtn: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.primarySoft },
  mediaMiniText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 13, fontWeight: '900' },
  receiptPreviewScreen: { flex: 1, backgroundColor: '#0b1715' },
  receiptPreviewImage: { flex: 1, width: '100%' },
  templateItem: { marginHorizontal: 14, marginTop: 10, padding: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md },
  templateName: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 15, fontWeight: '900', textAlign: 'right' }, templateBody: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, lineHeight: 17, marginTop: 5, textAlign: 'right' },
  editTemplates: { margin: 14, backgroundColor: colors.goldSoft, padding: 13, borderRadius: radius.md, alignItems: 'center' }, editTemplatesText: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.primary, fontWeight: '900' },
});
