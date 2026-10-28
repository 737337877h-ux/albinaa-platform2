import { requestActionStyles } from '../components/request-action-styles';
import React from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { fetchOracleRequestCatalog, fetchOracleRequestCurrencies } from '../api/endpoints';
import RequestSearchPicker, { RequestPickerOption } from '../components/request-search-picker';
import { colors, radius, shadow } from '../theme';
import { saveOfflineDraft, submitOfflineDraft } from '../utils/offline-request';
import { useSync } from '../store/sync-context';
import { pickFromCamera, pickFromGallery } from '../utils/image';
import { parseFlexibleDate, westernDigits } from '../utils/date-input';
import { resolveVoucherPresetParty } from '../utils/voucher-party';
import { normalizeVoucherAmount, voucherCounterAmount } from '../utils/voucher-conversion';

const categories = [
  ['customers', 'العملاء'], ['vendors', 'الموردون'], ['employees', 'الموظفون'], ['debtors', 'المدينون'],
  ['creditors', 'الدائنون'], ['custodies', 'العهد'], ['bank_accounts', 'حسابات البنوك'], ['other', 'أخرى'],
] as const;
const newReference = () => `mobile-voucher:${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const currencyCodesOf = (value: any): string[] => Array.isArray(value?.currencyCodes) ? value.currencyCodes.map(String) : [];
const displayCurrencyCode = (code: unknown) => ({ YR: 'YER', SR: 'SAR', $: 'USD' }[String(code).toUpperCase()] ?? String(code));
const preferredLocalCurrency = (options: RequestPickerOption[]) =>
  options.find((option) => ['YER', 'YR'].includes(String(option.key).toUpperCase()))
  ?? options.find((option) => (option.raw as any)?.local)
  ?? options[0];
type PaymentChannel = 'cash' | 'bank_transfer' | 'e_wallet';
const BANK_CODES = new Set(['202', '204']);
const WALLET_CODES = new Set(['203', '205', '207']);
// Private account artwork is intentionally excluded from the public source.
// The existing wallet icon is used until approved local artwork is configured.
const ACCOUNT_ICONS: Record<string, any> = {};

export default function RequestVoucherScreen({ route, navigation }: any) {
  const restoredDraft=route.params?.draftPayload as any|undefined;
  const kind = (route.params?.kind === 'payment' ? 'payment' : 'receipt') as 'receipt' | 'payment';
  const presetCode = String(route.params?.customerCode ?? '');
  const directCustomerReceipt = kind === 'receipt' && Boolean(presetCode);
  const forceNextFollowup = route.params?.forceNextFollowup === true;
  const [category, setCategory] = React.useState<string>('customers');
  const [partyOption, setPartyOption] = React.useState<RequestPickerOption | undefined>();
  const [accountOption, setAccountOption] = React.useState<RequestPickerOption | undefined>();
  const [currencyOption, setCurrencyOption] = React.useState<RequestPickerOption | undefined>();
  const [partyCurrencyOption, setPartyCurrencyOption] = React.useState<RequestPickerOption | undefined>();
  const [locationOption, setLocationOption] = React.useState<RequestPickerOption | undefined>();
  const [amount, setAmount] = React.useState(restoredDraft?.amount!=null?String(restoredDraft.amount):'');
  const [partyAmount, setPartyAmount] = React.useState(restoredDraft?.lines?.[0]?.amount!=null?String(restoredDraft.lines[0].amount):'');
  const [description, setDescription] = React.useState(String(restoredDraft?.description||(kind === 'receipt' ? 'تحصيل من تطبيق البناء الراقي' : 'صرف من تطبيق البناء الراقي')));
  const [recipientName, setRecipientName] = React.useState(String(restoredDraft?.recipientName??route.params?.customerName??''));
  const restoredLocationCode=String(restoredDraft?.cashOrBankNo??'');
  const [paymentChannel, setPaymentChannel] = React.useState<PaymentChannel>(WALLET_CODES.has(restoredLocationCode)?'e_wallet':BANK_CODES.has(restoredLocationCode)?'bank_transfer':'cash');
  const [referenceNo, setReferenceNo] = React.useState(String(restoredDraft?.referenceNo??''));
  const [noticeNo, setNoticeNo] = React.useState(String(restoredDraft?.noticeNo??''));
  const [expanded, setExpanded] = React.useState(true);
  const [externalReference] = React.useState(()=>String(restoredDraft?.externalReference||newReference()));
  const draftOperationId=String(route.params?.draftOperationId||restoredDraft?.externalReference||externalReference);
  const [imageUri, setImageUri] = React.useState<string|undefined>(restoredDraft?.__attachmentUri?String(restoredDraft.__attachmentUri):undefined);
  const [nextFollowupDate, setNextFollowupDate] = React.useState(String(restoredDraft?.nextFollowupDate??''));
  const { triggerSync } = useSync();
  const catalog = useQuery({ queryKey: ['mobile-request-catalog', kind], queryFn: async () => (await fetchOracleRequestCatalog(kind)).data });
  const currencies = useQuery({ queryKey: ['mobile-request-currencies'], queryFn: async () => (await fetchOracleRequestCurrencies()).data });
  const partyGroups = (catalog.data?.parties ?? {}) as Record<string, any[]>;
  const parties = ((partyGroups[category] ?? []) as any[]);
  const partyOptions = parties.map((party) => ({ key: String(party.code), label: party.nameAr || party.code, hint: String(party.code), raw: party }));
  const accounts = ((partyOption?.raw as any)?.linkedAccounts ?? []) as any[];
  const currencyOptions = ((currencies.data?.currencies ?? []) as any[]).map((currency) => ({ key: currency.code, label: `${currency.nameAr} — ${currency.code}`, hint: currency.local ? 'العملة المحلية' : undefined, raw: currency }));
  const accountOptions = accounts.map((account) => ({
    key: `${account.accountCode}|${account.analyticalAccountCode}|${account.analyticalType}`,
    label: account.analyticalAccountName || account.accountName,
    hint: `${account.accountCode} / ${account.analyticalAccountCode} • ${currencyCodesOf(account).join('، ') || 'دون عملة مفعلة'}`,
    raw: account,
  }));
  const sourceRate = currencyOptions.find(option => option.key === currencyOption?.key)?.raw;
  const targetRate = currencyOptions.find(option => option.key === partyCurrencyOption?.key)?.raw;
  const convertedAmount = voucherCounterAmount(amount, sourceRate, targetRate);
  const conversionKey = JSON.stringify([amount, currencyOption?.key, partyCurrencyOption?.key,
    sourceRate?.rate, sourceRate?.local, sourceRate?.fractionDigits, targetRate?.rate, targetRate?.local, targetRate?.fractionDigits]);
  const lastConversionKey = React.useRef('');
  React.useEffect(() => {
    if (!currencyOption || !partyCurrencyOption || !sourceRate || !targetRate) return;
    if (lastConversionKey.current === conversionKey) return;
    const preserveRestored = Boolean(restoredDraft) && !lastConversionKey.current;
    lastConversionKey.current = conversionKey;
    if (!preserveRestored) setPartyAmount(convertedAmount?.amount ?? '');
  }, [conversionKey, convertedAmount?.amount, currencyOption, partyCurrencyOption, restoredDraft, sourceRate, targetRate]);
  const partyCurrencyCodes = [...new Set(accounts.flatMap(currencyCodesOf))];
  const partyCurrencyOptions = partyOption
    ? currencyOptions.filter((option) => partyCurrencyCodes.includes(option.key))
    : currencyOptions;
  const matchingAccountOptions = partyCurrencyOption
    ? accountOptions.filter((option) => currencyCodesOf(option.raw).includes(partyCurrencyOption.key))
    : [];
  const oraclePaymentMethod = paymentChannel === 'cash' ? 'cash' : 'bank_transfer';
  const allLocationRows = paymentChannel === 'cash' ? catalog.data?.cashboxes ?? [] : catalog.data?.banks ?? [];
  const locationRows = (allLocationRows as any[]).filter((item) => {
    const code = String(item.code);
    if (paymentChannel === 'cash') return kind !== 'receipt' || code === '101';
    if (paymentChannel === 'bank_transfer') return BANK_CODES.has(code);
    return WALLET_CODES.has(code);
  });
  const locationOptions = locationRows.map((item) => ({
    key: String(item.code),
    label: `${item.nameAr || item.code} — ${item.code}`,
    hint: item.accountCode ? `الحساب الفرعي ${item.accountCode}` : undefined,
    raw: item,
  }));
  const locationCurrencyCodes = currencyCodesOf(locationOption?.raw);
  const documentCurrencyOptions = locationOption
    ? currencyOptions.filter((option) => locationCurrencyCodes.includes(option.key))
    : currencyOptions;
  const routeBalances = Array.isArray(route.params?.customerBalances) ? route.params.customerBalances as any[] : [];
  const selectedBalance = routeBalances.find((item) => {
    const code = String(item.currency ?? item.currencyCode ?? '').toUpperCase();
    const selected = String(partyCurrencyOption?.key ?? '').toUpperCase();
    return code === selected || (code === 'YER' && selected === 'YR') || (code === 'SAR' && selected === 'SR');
  });
  const currentDebt = Math.max(0, Number(selectedBalance?.operationalBalance ?? selectedBalance?.balance ?? selectedBalance?.accountingBalance ?? 0));
  const projectedRemaining = Math.max(0, currentDebt - Number(partyAmount || 0));
  const threshold = ['YER', 'YR'].includes(String(partyCurrencyOption?.key)) ? 3000 : ['SAR', 'SR'].includes(String(partyCurrencyOption?.key)) ? 30 : String(partyCurrencyOption?.key) === 'USD' ? 5 : 0;
  const requiresNextFollowup = forceNextFollowup || (directCustomerReceipt && projectedRemaining > threshold);

  React.useEffect(()=>{
    if(!restoredDraft||partyOption||!Object.keys(partyGroups).length||!currencyOptions.length)return;
    const line=restoredDraft.lines?.[0]||{};
    let foundCategory='other'; let foundParty:any;
    for(const [group,rows] of Object.entries(partyGroups)){const match=(rows as any[]).find((party)=>((party.linkedAccounts??[]) as any[]).some((account)=>String(account.accountCode)===String(line.accountCode)&&String(account.analyticalAccountCode)===String(line.analyticalAccountCode)));if(match){foundCategory=group;foundParty=match;break;}}
    if(foundParty){setCategory(foundCategory);const party={key:String(foundParty.code),label:String(foundParty.nameAr||foundParty.code),hint:String(foundParty.code),raw:foundParty};setPartyOption(party);const match=((foundParty.linkedAccounts??[]) as any[]).find((account)=>String(account.accountCode)===String(line.accountCode)&&String(account.analyticalAccountCode)===String(line.analyticalAccountCode));if(match)setAccountOption({key:`${match.accountCode}|${match.analyticalAccountCode}|${match.analyticalType}`,label:match.analyticalAccountName||match.accountName,raw:match});}
    const documentCurrency=currencyOptions.find((option)=>String(option.key)===String(restoredDraft.currencyCode));if(documentCurrency)setCurrencyOption(documentCurrency);
    const partyCurrency=currencyOptions.find((option)=>String(option.key)===String(line.currencyCode));if(partyCurrency)setPartyCurrencyOption(partyCurrency);
    const location=locationOptions.find((option)=>option.key===restoredLocationCode);if(location)setLocationOption(location);
  },[currencyOptions,locationOptions,partyGroups,partyOption,restoredDraft,restoredLocationCode]);

  React.useEffect(() => {
    if (partyOption || !presetCode) return;
    const resolved = resolveVoucherPresetParty(partyGroups, presetCode, route.params?.customerName);
    if (!resolved) return;
    setCategory(resolved.category);
    setPartyOption({
      key: String(resolved.party.code),
      label: String(resolved.party.nameAr || resolved.party.code),
      hint: String(resolved.party.code),
      raw: resolved.party,
    });
    setRecipientName((current) => current.trim() || String(resolved.party.nameAr || route.params?.customerName || ''));
  }, [partyGroups, partyOption, presetCode, route.params?.customerName]);
  React.useEffect(() => {
    if (!documentCurrencyOptions.length) {
      if (currencyOption) setCurrencyOption(undefined);
      return;
    }
    if (!currencyOption || !documentCurrencyOptions.some((option) => option.key === currencyOption.key)) {
      setCurrencyOption(preferredLocalCurrency(documentCurrencyOptions));
    }
  }, [currencyOption, documentCurrencyOptions]);
  React.useEffect(() => {
    if (!partyOption) return;
    if (!partyCurrencyOptions.length) {
      if (partyCurrencyOption) setPartyCurrencyOption(undefined);
      return;
    }
    if (!partyCurrencyOption || !partyCurrencyOptions.some((option) => option.key === partyCurrencyOption.key)) {
      setPartyCurrencyOption(preferredLocalCurrency(partyCurrencyOptions));
    }
  }, [partyCurrencyOption, partyCurrencyOptions, partyOption]);
  React.useEffect(() => {
    if (!partyOption || !partyCurrencyOption || !matchingAccountOptions.length) {
      if (accountOption) setAccountOption(undefined);
      return;
    }
    if (accountOption && matchingAccountOptions.some((option) => option.key === accountOption.key)) return;
    setAccountOption(matchingAccountOptions.length === 1 || directCustomerReceipt ? matchingAccountOptions[0] : undefined);
  }, [accountOption, directCustomerReceipt, matchingAccountOptions, partyCurrencyOption, partyOption]);
  React.useEffect(() => {
    if (locationOption || paymentChannel !== 'cash' || !locationOptions.length) return;
    setLocationOption(locationOptions.find((option) =>
      option.key === '101' || String((option.raw as any)?.accountCode) === '111101002') ?? locationOptions[0]);
  }, [locationOption, locationOptions, paymentChannel]);
  React.useEffect(() => {
    if (kind !== 'receipt') return;
    const customerName = partyOption?.label || route.params?.customerName || 'العميل';
    const reference = referenceNo.trim();
    const accountName = String((locationOption?.raw as any)?.nameAr || locationOption?.label || '').replace(/\s+—\s+\d+$/, '').trim();
    if (paymentChannel === 'e_wallet') {
      setDescription(`لكم إيداع عبر ${accountName || 'المحفظة الإلكترونية'}${reference ? ` رقم ${reference}` : ''} من الأخ ${customerName} دفعة من الحساب`);
    } else if (paymentChannel === 'bank_transfer') {
      setDescription(`لكم حوالة${reference ? ` رقم ${reference}` : ''} من الأخ ${customerName} دفعة من الحساب`);
    } else {
      setDescription(`لكم إيداع نقدًا${reference ? ` رقم ${reference}` : ''} من الأخ ${customerName} دفعة من الحساب`);
    }
  }, [kind, locationOption, partyOption, paymentChannel, referenceNo, route.params?.customerName]);

  const payload = React.useMemo(() => {
    const account = accountOption?.raw as any;
    const party = partyOption?.raw as any;
    const assignedCollector = party?.assignedCollector;
    return {
      kind, paymentMethod: oraclePaymentMethod, externalReference, currencyCode: currencyOption?.key || '', amount: Number(amount),
      cashOrBankNo: Number(locationOption?.key || 0), description, referenceNo: referenceNo ? westernDigits(referenceNo) : null,
      noticeNo: oraclePaymentMethod === 'bank_transfer' && noticeNo ? westernDigits(noticeNo) : null,
      collectorNo: kind === 'receipt' && assignedCollector ? Number(assignedCollector.code) : null,
      commissionPercent: kind === 'receipt' ? assignedCollector?.commissionPercent ?? null : null,
      recipientName: recipientName.trim() || party?.nameAr || null,
      ...(directCustomerReceipt ? { platformCustomerId: String(route.params?.customerId ?? ''), platformCustomerCode: presetCode, nextFollowupDate: nextFollowupDate || null } : {}),
      lines: [{ currencyCode: partyCurrencyOption?.key || '', amount: Number(partyAmount), accountCode: account?.accountCode || '', analyticalAccountCode: account?.analyticalAccountCode || '', analyticalType: account?.analyticalType || 0, description }],
    };
  }, [accountOption, amount, currencyOption, description, directCustomerReceipt, externalReference, kind, locationOption, nextFollowupDate, noticeNo, oraclePaymentMethod, partyAmount, partyCurrencyOption, partyOption, presetCode, recipientName, route.params?.customerId, referenceNo]);
  const validate = () => {
    const missing = [
      !partyOption && 'طرف السند',
      !accountOption && 'الحساب المرتبط',
      !locationOption && (paymentChannel === 'cash' ? 'الصندوق' : paymentChannel === 'e_wallet' ? 'المحفظة' : 'البنك'),
      !currencyOption && 'عملة الصندوق أو البنك',
      !(Number(amount) > 0) && 'مبلغ الصندوق أو البنك',
      !partyCurrencyOption && 'عملة الطرف',
      !(Number(partyAmount) > 0) && 'مبلغ الطرف',
      !description.trim() && 'البيان',
      !recipientName.trim() && 'اسم المستلم',
    ].filter(Boolean);
    if (missing.length) {
      Alert.alert('بيانات ناقصة', `أكمل: ${missing.join('، ')}.`); return false;
    }
    if (!partyOption || !accountOption || !locationOption || !currencyOption || !partyCurrencyOption) return false;
    if (oraclePaymentMethod === 'bank_transfer' && (!referenceNo.trim() || !noticeNo.trim())) {
      Alert.alert('بيانات ناقصة', `رقم المرجع ورقم الإشعار مطلوبان لـ${paymentChannel === 'e_wallet' ? 'لمحفظة الإلكترونية' : 'لتحويل البنكي'}.`); return false;
    }
    if (!currencyCodesOf(locationOption.raw).includes(currencyOption.key)) {
      Alert.alert('عملة غير مفعلة', `${paymentChannel === 'cash' ? 'الصندوق' : paymentChannel === 'e_wallet' ? 'المحفظة' : 'البنك'} المحدد لا يملك حسابًا بعملة ${currencyOption.key}.`); return false;
    }
    if (!currencyCodesOf(accountOption.raw).includes(partyCurrencyOption.key)) {
      Alert.alert('عملة غير مفعلة', `حساب الطرف المحدد لا يملك عملة ${partyCurrencyOption.key}.`); return false;
    }
    if (requiresNextFollowup && !/^\d{4}-\d{2}-\d{2}$/.test(nextFollowupDate)) {
      Alert.alert('موعد المتبقي مطلوب', 'التحصيل جزئي؛ حدد موعد المتابعة القادمة للرصيد المتبقي.'); return false;
    }
    return true;
  };
  const localPayload={...payload,...(imageUri?{__attachmentUri:imageUri,__attachmentName:imageUri.split('/').pop()||'receipt.jpg'}:{})};
  const saveOffline = async () => { if (!validate()) return; await saveOfflineDraft({ kind, title: kind === 'receipt' ? 'تحصيل' : 'سند صرف', endpoint: '/oracle-test-requests/vouchers', operationId:draftOperationId, payload:localPayload }); Alert.alert('حُفظت المسودة', `بقيت في قاعدة الهاتف فقط ويمكن تعديلها من عمليات ONYX.${imageUri?' وستبقى صورة الإيصال مرتبطة بها.':''}`, [{ text: 'حسنًا', onPress: () => navigation.goBack() }]); };
  const inspectAndSend=async()=>{if(!validate())return;await submitOfflineDraft({kind,title:kind==='receipt'?'تحصيل':'سند صرف',endpoint:'/oracle-test-requests/vouchers',operationId:draftOperationId,payload:localPayload});void triggerSync().catch(()=>undefined);Alert.alert('بدأ الفحص والإرسال','سيفحص التطبيق السند أولًا، ثم يحفظه ويرفع صورة الإيصال عند نجاح الفحص.',[{text:'حسنًا',onPress:()=>navigation.goBack()}]);};

  if (catalog.isLoading || currencies.isLoading) return <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>جار تحميل الأطراف والحسابات من IAS20261…</Text></View>;
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={70}><ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    {(catalog.isError || currencies.isError) && <View style={styles.error}><Text style={styles.errorText}>تعذر تحميل الأطراف والحسابات. تحقق من اتصال بوابة Oracle ثم أعد المحاولة؛ لم تُرسل أي بيانات.</Text><TouchableOpacity onPress={() => { catalog.refetch(); currencies.refetch(); }}><Text style={styles.retry}>إعادة المحاولة</Text></TouchableOpacity></View>}
    {catalog.data?.currencyMapping?.complete === false && <View style={styles.error}><Text style={styles.errorText}>تأكيد عملات الحسابات متوقف. يلزم منح ALBINAA_RO قراءة CUSTOMER_CURR وACCOUNT_CURR في IAS20261؛ تم منع الفحص بدل تخمين العملة.</Text></View>}
    <View style={styles.formSection}>
      <Text style={styles.sectionHeading}>طريقة الدفع والحساب</Text>
    <View style={styles.segment}>{([
      ['cash', 'نقدي', 'cash-outline'],
      ['bank_transfer', 'تحويل بنكي', 'business-outline'],
      ['e_wallet', 'محفظة إلكترونية', 'phone-portrait-outline'],
    ] as const).map(([value, label, icon]) => <TouchableOpacity key={value} style={[styles.segmentButton, paymentChannel === value && styles.segmentActive]} onPress={() => { setPaymentChannel(value); setLocationOption(undefined); setCurrencyOption(undefined); }}><Ionicons name={icon} size={17} color={paymentChannel === value ? '#fff' : colors.primary} /><Text style={[styles.segmentText, paymentChannel === value && styles.segmentTextActive]}>{label}</Text></TouchableOpacity>)}</View>
    <AccountButtons label={paymentChannel === 'cash' ? 'الصندوق' : paymentChannel === 'e_wallet' ? 'المحفظة الإلكترونية' : 'البنك'} value={locationOption} options={locationOptions} onSelect={setLocationOption} />
    {locationOptions.length === 0 && <Text style={styles.currencyWarning}>لا توجد حسابات مفعلة للأرقام المطلوبة في IAS20261.</Text>}
    </View>
    <TouchableOpacity style={styles.collapseHeader} onPress={() => setExpanded((value) => !value)}><Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.primary} /><Text style={styles.collapseTitle}>{directCustomerReceipt ? 'بيانات العميل المحمّلة تلقائيًا' : 'طرف السند'}</Text></TouchableOpacity>
    {expanded && <View style={styles.card}>
      {!directCustomerReceipt && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>{categories.map(([key,label]) => <TouchableOpacity key={key} style={[styles.category, category === key && styles.categoryActive]} onPress={() => { setCategory(key); setPartyOption(undefined); setAccountOption(undefined); setRecipientName(''); }}><Text style={[styles.categoryText, category === key && styles.categoryTextActive]}>{label}</Text></TouchableOpacity>)}</ScrollView>}
      {directCustomerReceipt ? <View style={styles.lockedParty}><Text style={styles.label}>اسم العميل</Text><Text style={styles.lockedPartyName}>{partyOption?.label ?? route.params?.customerName ?? 'جار تحميل العميل…'}</Text><Text style={styles.lockedPartyCode}>{presetCode}</Text></View> : <RequestSearchPicker label="اسم العميل/الطرف" value={partyOption} options={partyOptions} onSelect={(option) => { setPartyOption(option); setAccountOption(undefined); setRecipientName(option?.label ?? ''); }} />}
      {!directCustomerReceipt && matchingAccountOptions.length > 1 && <RequestSearchPicker label="اختر الحساب" value={accountOption} options={matchingAccountOptions} onSelect={setAccountOption} />}
    </View>}
    <View style={styles.formSection}>
      <Text style={styles.sectionHeading}>المبالغ والعملات</Text>
    <CurrencyButtons label={paymentChannel === 'cash' ? 'عملة الصندوق' : paymentChannel === 'e_wallet' ? 'عملة المحفظة' : 'عملة البنك'} value={currencyOption} options={documentCurrencyOptions} onSelect={setCurrencyOption} />
    <Field label={paymentChannel === 'cash' ? 'مبلغ الصندوق' : paymentChannel === 'e_wallet' ? 'مبلغ المحفظة' : 'مبلغ البنك'} value={amount} onChangeText={v => setAmount(normalizeVoucherAmount(v))} keyboardType="decimal-pad" />
      <CurrencyButtons label="عملة الطرف" value={partyCurrencyOption} options={partyCurrencyOptions} onSelect={setPartyCurrencyOption} />
      {partyOption && partyCurrencyOptions.length === 0 && <Text style={styles.currencyWarning}>لا توجد عملة مفعلة لهذا الطرف في IAS20261.</Text>}
      <Field label="مبلغ الطرف" value={partyAmount} onChangeText={v => setPartyAmount(normalizeVoucherAmount(v))} keyboardType="decimal-pad" />
      {convertedAmount ? <>
        <Text style={styles.helper}>المقابل بسعر النظام: {convertedAmount.amount} {displayCurrencyCode(partyCurrencyOption?.key)} — سعر التحويل: {convertedAmount.rate.toPrecision(8)}. يعاد التحقق قبل الإرسال.</Text>
        {convertedAmount.amount !== partyAmount && <TouchableOpacity onPress={() => setPartyAmount(convertedAmount.amount)}><Text style={styles.lockedHint}>اعتماد المبلغ المحسوب بسعر النظام</Text></TouchableOpacity>}
        {convertedAmount.roundingDifference !== 0 && <Text style={styles.currencyWarning}>يوجد فرق تقريب {convertedAmount.roundingDifference} بالعملة المحلية؛ يجب أن ينجح فحص التوازن قبل الإرسال.</Text>}
      </> : Number(amount) > 0 && <Text style={styles.currencyWarning}>حدد عملتي الحسابين وتأكد من توفر أسعار النظام؛ لن يتم تخمين سعر الصرف.</Text>}
      {(forceNextFollowup || (directCustomerReceipt && currentDebt > 0)) && <View style={styles.remainingCard}>{directCustomerReceipt && currentDebt > 0 ? <><BalanceRow label="الرصيد قبل التحصيل" value={`${formatNumber(currentDebt)} ${displayCurrencyCode(partyCurrencyOption?.key ?? '')}`} /><BalanceRow label="المتبقي المتوقع" value={`${formatNumber(projectedRemaining)} ${displayCurrencyCode(partyCurrencyOption?.key ?? '')}`} strong /></> : null}{requiresNextFollowup && <Field label="موعد متابعة المتبقي *" value={nextFollowupDate} onChangeText={setNextFollowupDate} placeholder="مثال: 1209" onBlur={() => { const parsed = parseFlexibleDate(nextFollowupDate); if (parsed) setNextFollowupDate(parsed.iso); }} helper="أدخل موعد متابعة الرصيد المتبقي، مثل 1209 ليصبح 12/09 من السنة الحالية" />}</View>}
      {directCustomerReceipt && accountOption && <Text style={styles.lockedHint}>تم تثبيت الطرف على العميل المفتوح؛ المحصل والحساب مرتبطان آليًا ببيانات IAS20261.</Text>}
      {directCustomerReceipt && partyOption && !accountOption && <Text style={styles.currencyWarning}>تعذر تحديد الحساب المرتبط بهذه العملة. حدّث البيانات أو اختر عملة أخرى مفعلة للحساب.</Text>}
        </View>
    <View style={styles.formSection}>
      <Text style={styles.sectionHeading}>بيانات السند</Text>
    <Field label="البيان" value={description} onChangeText={setDescription} />
    <Field label="اسم المستلم *" value={recipientName} onChangeText={setRecipientName} placeholder="اسم الشخص الذي سلّم أو استلم المبلغ" />
    {oraclePaymentMethod === 'bank_transfer' ? <View style={styles.row}><View style={styles.column}><Field label="رقم المرجع" value={referenceNo} onChangeText={(value)=>setReferenceNo(westernDigits(value))} /></View><View style={styles.column}><Field label="رقم الإشعار" value={noticeNo} onChangeText={(value)=>setNoticeNo(westernDigits(value))} /></View></View> : <Field label="رقم المرجع (اختياري)" value={referenceNo} onChangeText={(value)=>setReferenceNo(westernDigits(value))} />}
    </View>
    <View style={styles.receiptCard}><View style={styles.receiptHeader}><Ionicons name="image-outline" size={20} color={colors.primary}/><Text style={styles.receiptTitle}>صورة إيصال {kind==='receipt'?'التحصيل':'الصرف'}</Text></View>{imageUri&&<Image source={{uri:imageUri}} style={styles.receiptPreview}/>}<View style={styles.receiptActions}><TouchableOpacity style={styles.receiptButton} onPress={async()=>{const uri=await pickFromCamera();if(uri)setImageUri(uri);}}><Text style={styles.receiptButtonText}>تصوير</Text></TouchableOpacity><TouchableOpacity style={styles.receiptButton} onPress={async()=>{const uri=await pickFromGallery();if(uri)setImageUri(uri);}}><Text style={styles.receiptButtonText}>المعرض</Text></TouchableOpacity>{imageUri&&<TouchableOpacity style={styles.receiptRemove} onPress={()=>setImageUri(undefined)}><Text style={styles.receiptRemoveText}>إزالة</Text></TouchableOpacity>}</View><Text style={styles.receiptHint}>تُحفظ الصورة على الهاتف بلا اتصال وتُرفع تلقائيًا إلى المنصة بعد مزامنة السند.</Text></View>
    <View style={styles.actions}><TouchableOpacity style={styles.secondary} onPress={saveOffline}><Text style={styles.secondaryText}>حفظ مسودة</Text></TouchableOpacity><TouchableOpacity style={styles.primary} onPress={inspectAndSend}><Text style={styles.primaryText}>فحص وإرسال الطلب</Text></TouchableOpacity></View>
  </ScrollView></KeyboardAvoidingView>;
}

function Field({ label, value, onChangeText, keyboardType, placeholder, onBlur, helper }:{ label:string; value:string; onChangeText:(value:string)=>void; keyboardType?:any; placeholder?:string; onBlur?:()=>void; helper?:string }) { return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} value={value} onChangeText={onChangeText} keyboardType={keyboardType} textAlign="right" placeholder={placeholder} onBlur={onBlur} placeholderTextColor={colors.muted} />{!!helper && <Text style={styles.helper}>{helper}</Text>}</View>; }
function AccountButtons({label,value,options,onSelect}:{label:string;value?:RequestPickerOption;options:RequestPickerOption[];onSelect:(option:RequestPickerOption)=>void}) { return <View style={styles.choiceSection}><Text style={styles.label}>{label}</Text><View style={styles.accountGrid}>{options.map((option) => { const selected=value?.key===option.key; const icon=ACCOUNT_ICONS[option.key]; return <TouchableOpacity key={option.key} style={[styles.accountButton,selected&&styles.accountButtonActive]} onPress={()=>onSelect(option)}>{icon ? <View style={styles.accountIconWrap}><Image source={icon} style={styles.accountIcon}/></View> : <View style={styles.accountIconWrap}><Ionicons name="wallet-outline" size={18} color={colors.primary}/></View>}<View style={styles.accountTextWrap}><Text numberOfLines={1} style={[styles.accountName,selected&&styles.accountNameActive]}>{String((option.raw as any)?.nameAr || option.label)}</Text><Text style={[styles.accountCode,selected&&styles.accountCodeActive]}>#{option.key}</Text></View>{selected&&<Ionicons name="checkmark-circle" size={17} color={colors.gold}/>}</TouchableOpacity>;})}</View></View>; }
function CurrencyButtons({label,value,options,onSelect}:{label:string;value?:RequestPickerOption;options:RequestPickerOption[];onSelect:(option:RequestPickerOption)=>void}) { return <View style={styles.choiceSection}><Text style={styles.label}>{label}</Text><View style={styles.currencyGrid}>{options.map((option)=>{const selected=value?.key===option.key;return <TouchableOpacity key={option.key} style={[styles.currencyButton,selected&&styles.currencyButtonActive]} onPress={()=>onSelect(option)}><Text style={[styles.currencyCode,selected&&styles.currencyCodeActive]}>{displayCurrencyCode(option.key)}</Text><Text numberOfLines={1} style={[styles.currencyName,selected&&styles.currencyNameActive]}>{String((option.raw as any)?.nameAr || option.label).split('—')[0].trim()}</Text></TouchableOpacity>;})}</View></View>; }
function BalanceRow({label,value,strong=false}:{label:string;value:string;strong?:boolean}) { return <View style={styles.balanceRow}><Text style={[styles.balanceValue,strong&&styles.balanceStrong]}>{value}</Text><Text style={styles.balanceLabel}>{label}</Text></View>; }
function formatNumber(value: unknown) { const number=Number(value); return Number.isFinite(number)?new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(number):'—'; }
const styles = StyleSheet.create({
  formSection: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 12 },
  sectionHeading: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 18, textAlign: 'right', marginBottom: 14 },
  screen:{flex:1,backgroundColor:colors.background},content:{padding:14,paddingBottom:44},loading:{flex:1,alignItems:'center',justifyContent:'center',gap:10,backgroundColor:colors.background},loadingText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,fontWeight:'800'},
  error:{backgroundColor:'#FDECEC',borderRadius:radius.md,padding:13,marginBottom:12},errorText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.danger,textAlign:'right',lineHeight:21,fontWeight:'800'},retry:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.primary,textAlign:'center',marginTop:10,fontWeight:'900'},
  segment:{flexDirection:'row-reverse',gap:6,marginBottom:12},segmentButton:{flex:1,minHeight:56,borderWidth:1,borderColor:colors.line,borderRadius:radius.sm,alignItems:'center',justifyContent:'center',gap:3,backgroundColor:colors.surface,paddingHorizontal:4},segmentActive:{backgroundColor:colors.primary,borderColor:colors.primary},segmentText:{ fontFamily: 'TajawalBold',color:colors.ink,fontSize:13,fontWeight:'900',textAlign:'center'},segmentTextActive:{color:'#fff'},
  field:{marginBottom:11},label:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,fontWeight:'900',textAlign:'right',marginBottom:6},input:{minHeight:50,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:radius.sm,paddingHorizontal:12,color:colors.ink},helper:{ fontFamily: 'TajawalRegular',color:colors.muted,fontSize:13,textAlign:'right',marginTop:4},row:{flexDirection:'row-reverse',gap:8},column:{flex:1},
  choiceSection:{marginBottom:11},accountGrid:{gap:7},accountButton:{minHeight:58,flexDirection:'row-reverse',alignItems:'center',gap:9,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:radius.sm,paddingHorizontal:10,paddingVertical:7},accountButtonActive:{borderColor:colors.primary,backgroundColor:colors.primarySoft},accountIconWrap:{width:34,height:34,borderRadius:10,alignItems:'center',justifyContent:'center',overflow:'hidden',backgroundColor:'#fff'},accountIcon:{width:26,height:26,resizeMode:'contain'},accountTextWrap:{flex:1},accountName:{ fontFamily: 'TajawalBold',color:colors.ink,fontWeight:'900',textAlign:'right',fontSize:14},accountNameActive:{color:colors.primary},accountCode:{ fontFamily: 'TajawalRegular',color:colors.muted,textAlign:'right',fontSize:13,marginTop:2},accountCodeActive:{color:colors.primary},currencyGrid:{flexDirection:'row-reverse',flexWrap:'wrap',gap:7},currencyButton:{minWidth:'30%',flexGrow:1,minHeight:51,borderRadius:radius.sm,borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center',paddingHorizontal:7},currencyButtonActive:{backgroundColor:colors.gold,borderColor:colors.gold},currencyCode:{ fontFamily: 'TajawalBold',color:colors.primary,fontSize:15,fontWeight:'900'},currencyCodeActive:{color:colors.primary},currencyName:{ fontFamily: 'TajawalBold',color:colors.muted,fontSize:13,fontWeight:'700',marginTop:1},currencyNameActive:{color:colors.primary},
  collapseHeader:{minHeight:52,flexDirection:'row',justifyContent:'space-between',alignItems:'center',backgroundColor:colors.primarySoft,borderRadius:radius.md,paddingHorizontal:13,marginTop:4},collapseTitle:{ fontFamily: 'TajawalBold',color:colors.primary,fontSize:16,fontWeight:'900'},card:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:radius.md,padding:12,marginTop:8,...shadow},categoryRow:{gap:7,paddingBottom:11},category:{paddingHorizontal:11,paddingVertical:8,borderRadius:999,borderWidth:1,borderColor:colors.line},categoryActive:{backgroundColor:colors.primary,borderColor:colors.primary},categoryText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,fontWeight:'800'},categoryTextActive:{color:'#fff'},
  lockedParty:{marginBottom:11},lockedPartyName:{ fontFamily: 'TajawalBold', fontSize: 15,minHeight:38,color:colors.ink,textAlign:'right',fontWeight:'900',backgroundColor:colors.primarySoft,borderRadius:radius.sm,padding:10},lockedPartyCode:{ fontFamily: 'TajawalRegular',color:colors.muted,textAlign:'right',fontSize:13,marginTop:3},lockedHint:{ fontFamily: 'TajawalRegular',color:colors.muted,textAlign:'right',fontSize:13,lineHeight:19,marginTop:9},balanceCard:{backgroundColor:colors.primarySoft,borderWidth:1,borderColor:colors.primary,borderRadius:radius.md,padding:12,marginTop:12},balanceError:{backgroundColor:'#FDECEC',borderColor:colors.danger},balanceTitle:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,fontWeight:'900',textAlign:'right',marginBottom:7},balanceRow:{flexDirection:'row-reverse',justifyContent:'space-between',gap:8,paddingVertical:5,borderTopWidth:1,borderTopColor:colors.line},balanceLabel:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,fontWeight:'800'},balanceValue:{ fontFamily: 'TajawalBold', fontSize: 15,flex:1,color:colors.primary,fontWeight:'800',textAlign:'left'},balanceStrong:{ fontFamily: 'TajawalBold', fontSize: 15,fontWeight:'900'},
  currencyWarning:{ fontFamily: 'TajawalBold',color:colors.danger,textAlign:'right',fontWeight:'800',fontSize:13,marginBottom:10},
  remainingCard:{backgroundColor:colors.goldSoft,borderRadius:radius.sm,padding:10,marginTop:6},
  receiptCard:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:radius.md,padding:12,marginTop:12},receiptHeader:{flexDirection:'row-reverse',alignItems:'center',gap:7},receiptTitle:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,fontWeight:'900'},receiptPreview:{width:'100%',height:180,borderRadius:radius.sm,marginTop:10,resizeMode:'contain',backgroundColor:colors.background},receiptActions:{flexDirection:'row-reverse',gap:7,marginTop:10},receiptButton:{flex:1,minHeight:42,alignItems:'center',justifyContent:'center',borderRadius:radius.sm,backgroundColor:colors.primarySoft},receiptButtonText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.primary,fontWeight:'900'},receiptRemove:{minHeight:42,paddingHorizontal:15,alignItems:'center',justifyContent:'center',borderRadius:radius.sm,backgroundColor:'#FDECEC'},receiptRemoveText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.danger,fontWeight:'900'},receiptHint:{ fontFamily: 'TajawalRegular',color:colors.muted,textAlign:'right',fontSize:13,lineHeight:18,marginTop:8},
  actions:{flexDirection:'row-reverse',gap:9,marginTop:15},primary:{ ...requestActionStyles.primary, flex:2 },primaryText:{ ...requestActionStyles.primaryText, fontWeight:'900' },secondary:{ ...requestActionStyles.secondary, flex:1 },secondaryText:{ ...requestActionStyles.secondaryText, fontWeight:'900' },disabled:{opacity:.4},
});
