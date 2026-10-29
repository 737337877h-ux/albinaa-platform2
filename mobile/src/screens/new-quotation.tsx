import BarcodeEntrySetting, {useBarcodeEntrySetting} from '../components/barcode-entry-setting';
import {incrementBarcodeLine, barcodeItem} from '../utils/barcode-lines';
import React from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TextInputProps, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RequestSearchPicker, { RequestPickerOption as Option } from '../components/request-search-picker';
import RequestUnitPickerModal from '../components/request-unit-picker-modal';
import { revealInput } from '../utils/keyboard';
import RequestBarcodeScanner from '../components/request-barcode-scanner';
import { fetchTransferItem, fetchTransferWarehouses, searchTransferItems } from '../api/endpoints';
import { dryRunQuotation } from '../api/quotations';
import { getCustomerOptionsOffline, getOfflineRequests } from '../db/database';
import { useSync } from '../store/sync-context';
import { useAuth } from '../store/auth-context';
import { newOfflineOperationId, saveOfflineDraft, submitOfflineDraft } from '../utils/offline-request';
import { newQuotationReference } from '../utils/quotation-sync';
import { westernDigits } from '../utils/date-input';
import { colors, radius } from '../theme';

type Line = { expanded: boolean; id: string; item?: Option; unit?: Option; units: Option[]; quantity: string; price: string };
const blank = (): Line => ({ expanded: true, id: newQuotationReference(), units: [], quantity: '1', price: '' });
const option = (key?: string): Option | undefined => key ? { key, label: key, hint: key } : undefined;
const errorText = (error: any) => String(error?.response?.data?.message || error?.message || 'تعذر حفظ العرض');

export default function NewQuotationScreen({ navigation, route }: any) {
  const {automatic,setAutomatic}=useBarcodeEntrySetting();
  const draft = route.params?.draftPayload;
  const [operationId] = React.useState(() => route.params?.draftOperationId || newOfflineOperationId('quotation'));
  const [externalReference] = React.useState(() => draft?.externalReference || newQuotationReference());
  const [customer, setCustomer] = React.useState<Option | undefined>(option(draft?.customerCode));
  const [warehouse, setWarehouse] = React.useState<Option | undefined>(option(draft?.warehouseCode));
  const [currency, setCurrency] = React.useState(draft?.currencyCode || 'YR');
  const [notes, setNotes] = React.useState(draft?.notes || '');
  const [lines, setLines] = React.useState<Line[]>(() => draft?.lines?.length ? draft.lines.map((row: any) => ({
    ...blank(), item: option(row.itemCode), unit: option(row.unitCode), units: [option(row.unitCode)!],
    quantity: String(row.quantity), price: String(row.price),
  })) : [blank()]);
  const [search, setSearch] = React.useState('');
  const [scanId, setScanId] = React.useState<string>();
  const [unitId, setUnitId] = React.useState<string>();
  const scrollRef = React.useRef<ScrollView | null>(null);
  const inputRefs = React.useRef<Record<string, TextInput | null>>({});
  const advanceTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(advanceTimer.current), []);
  const later = (action: () => void) => {
    clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(action, 220);
  };
  const focusField = (id: string, field: string) => later(() => revealInput(scrollRef.current, inputRefs.current[`${id}:${field}`], 170));
  const [busy, setBusy] = React.useState(false);
  const locked = React.useRef(false);
  const { triggerSync, refreshStatus } = useSync();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const canManage = user?.permissions?.includes('sales_order_drafts.manage');
  const customers = useQuery({ queryKey: ['quotation-customers'], queryFn: getCustomerOptionsOffline });
  const warehouses = useQuery({ queryKey: ['request-warehouses'], queryFn: async () => (await fetchTransferWarehouses()).data });
  const deferredSearch = React.useDeferredValue(search);
  const items = useQuery({ queryKey: ['request-items', deferredSearch], queryFn: async () => (await searchTransferItems(deferredSearch)).data });
  const customerOptions = (customers.data || []).flatMap((row: any) => {
    const code = String(row.externalCustomerCode || row.accountNumber || '').trim();
    return code ? [{ key: code, label: row.fullName || code, hint: code }] : [];
  });
  const warehouseOptions = (warehouses.data?.items ?? warehouses.data ?? []).map((row: any) => ({
    key: String(row.externalWarehouseCode ?? row.code), label: row.nameAr ?? row.name ?? row.code, hint: String(row.externalWarehouseCode ?? row.code),
  }));
  const itemOptions = (items.data?.items ?? items.data ?? []).map((row: any) => ({
    key: String(row.externalItemCode ?? row.itemCode), label: row.nameAr ?? row.itemName ?? row.itemCode, hint: String(row.externalItemCode ?? row.itemCode),
  }));
  const patch = (id: string, change: Partial<Line>) => setLines(rows => rows.map(row => row.id === id ? { ...row, ...change } : row));
  const chooseItem = async (id: string, selected: Option) => {
    try {
      const detail = (await fetchTransferItem(selected.key)).data;
      const units = (detail.units || []).filter((row: any) => row.isInactive !== true).map((row: any) => ({
        key: String(row.unitName ?? row.unitCode), label: String(row.unitName ?? row.unitCode), hint: `حجم العبوة ${row.packageSize ?? 1}`,
      }));
      if (!units.length) throw new Error('لا توجد وحدة مفعلة لهذا الصنف في البيانات المحلية');
      patch(id, { item: selected, units, unit: units.length === 1 ? units[0] : undefined, expanded: true });
      if (units.length > 1) later(() => setUnitId(id)); else focusField(id, 'quantity');
    } catch (error) { Alert.alert('تعذر اختيار الصنف', errorText(error)); }
  };
  const incrementExisting=(code:string)=>{const matches=lines.filter(line=>line.item?.key===code);if(!matches.length)return false;if(matches.length>1){Alert.alert('اختر السطر','الصنف موجود بأكثر من وحدة أو سعر؛ عدّل كمية السطر المطلوب.');return true;}const target=matches[0];setLines(rows=>incrementBarcodeLine(rows,target.id));focusField(target.id, 'quantity');return true;};
  const scan = async (code: string) => {
    const id = scanId; setScanId(undefined); if (!id) return;
    try {
      const data = (await searchTransferItems(code)).data;
      const rows = data?.items ?? data ?? [];
      const row = barcodeItem(rows,code);
      if(!row) throw new Error('لم يُعثر على صنف واحد مطابق');
      if(incrementExisting(String(row.externalItemCode??row.itemCode)))return;
      await chooseItem(id, { key: String(row.externalItemCode ?? row.itemCode), label: row.nameAr ?? row.itemName ?? code });
    } catch (error) { Alert.alert('قراءة الباركود', errorText(error)); }
  };
  const finishLine = (id: string) => {
    const row = lines.find(line => line.id === id);
    if (!row?.item || !row.unit || ![row.quantity, row.price].every(value => /^\d{1,9}(\.\d{1,6})?$/.test(westernDigits(value).trim())) ||
      Number(westernDigits(row.quantity)) <= 0 || Number(westernDigits(row.price)) <= 0) {
      Alert.alert('أكمل السطر', 'اختر الوحدة وأدخل كمية وسعرًا أكبر من صفر.'); return;
    }
    Keyboard.dismiss();
    const empty = lines.find(line => line.id !== id && !line.item && !line.price.trim());
    const next = empty ?? (lines.length < 50 ? blank() : undefined);
    setLines(rows => {
      const updated = rows.map(line => line.id === id ? { ...line, expanded: false } : line);
      return next && !empty ? [...updated, next] : updated;
    });
    if (next && automatic) later(() => setScanId(next.id));
  };
  const net = lines.reduce((sum, row) => sum + Number(westernDigits(row.quantity)) * Number(westernDigits(row.price)), 0);

  const save = async (submit: boolean) => {
    if (locked.current || !canManage) return;
    locked.current = true; setBusy(true);
    try {
      const existing = (await getOfflineRequests()).find((row: any) => row.operationId === operationId);
      // Even a blocked retry may follow a lost successful response: preserve submitted contents.
      if (existing && existing.status !== 'draft') throw new Error('هذا العرض أُرسل بالفعل. تابع حالته أو أعد مزامنته من عمليات ONYX دون تغيير محتواه.');
      if (!customer || !warehouse) throw new Error('اختر العميل والمخزن');
      const payload = {
        externalReference, customerCode: customer.key, warehouseCode: warehouse.key, currencyCode: currency, notes: notes.trim(),
        lines: lines.filter(row => row.item || row.unit || row.price.trim() || westernDigits(row.quantity).trim() !== '1').map(row => ({ itemCode: row.item?.key || '', unitCode: row.unit?.key || '',
          quantity: westernDigits(row.quantity).trim(), price: westernDigits(row.price).trim(), discount: '0' })),
      };
      if (!payload.lines.length || payload.lines.length > 50 || payload.lines.some(row => !row.itemCode || !row.unitCode ||
        ![row.quantity, row.price].every(value => /^\d{1,9}(\.\d{1,6})?$/.test(value)) ||
        Number(row.quantity) <= 0 || Number(row.price) <= 0)) {
        throw new Error('أكمل الأصناف والوحدات. الكمية والسعر أكبر من صفر (حتى 50 صنفًا).');
      }
      const options = { kind: 'quotation' as const, title: `عرض سعر — ${customer.label}`, endpoint: '/quotations', operationId, payload };
      // Persist first so validation/network failures never discard the user's input.
      await saveOfflineDraft(options);
      if (submit) {
        let check;
        try {
          check = await dryRunQuotation(payload);
        } catch (error: any) {
          if (error?.response) throw error;
          // Offline submission stays queued; the writer validates again before saving.
        }
        if (check && check.data?.valid !== true) throw new Error('لم يجتز عرض السعر الفحص');
        await submitOfflineDraft({ ...options, payload: { ...payload, __offlineWorkflow: 'quotation-submit' } });
        void triggerSync().catch(() => undefined);
      }
      await refreshStatus();
      Alert.alert(submit ? 'أضيف إلى طابور الإرسال' : 'حُفظت المسودة', submit
        ? 'سيُفحص ويُحفظ في Oracle 2026 كعرض غير معتمد. تابع التأكيد ورقم العرض في شاشة عروض الأسعار.'
        : 'المسودة محفوظة على الهاتف. افتحها من عمليات ONYX للتعديل أو الإرسال.', [{ text: 'حسنًا', onPress: () => navigation.goBack() }]);
    } catch (error) { Alert.alert('عرض السعر', errorText(error)); }
    finally { locked.current = false; setBusy(false); }
  };

  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={80}>
    <ScrollView ref={scrollRef} automaticallyAdjustKeyboardInsets contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
<BarcodeEntrySetting value={automatic} onChange={setAutomatic}/>
      <Text style={styles.notice}>عرض سعر غير معتمد • 2026 • الفرع 1 • دون ضريبة</Text>
      <View pointerEvents={busy ? 'none' : 'auto'}>
        <View style={styles.card}>
          <RequestSearchPicker label="العميل" value={customerOptions.find((row: Option) => row.key === customer?.key) || customer} options={customerOptions} onSelect={setCustomer} loading={customers.isLoading} />
          <RequestSearchPicker label="المخزن" value={warehouseOptions.find((row: Option) => row.key === warehouse?.key) || warehouse} options={warehouseOptions} onSelect={setWarehouse} loading={warehouses.isLoading} />
          <RequestSearchPicker label="العملة" value={option(currency)} options={['YR', 'SR', '$'].map(code => option(code)!)} onSelect={row => setCurrency(row.key)} />
        </View>
        {lines.map((line, index) => !line.expanded && line.item ? <TouchableOpacity style={styles.card} key={line.id} onPress={() => patch(line.id, { expanded: true })}>
          <Text style={styles.title}>✓ {index + 1}. {line.item.label}</Text>
          <Text style={styles.notice}>{line.quantity} {line.unit?.label} × {line.price} {currency}</Text>
          <Text style={styles.label}>اضغط للتعديل</Text>
        </TouchableOpacity> : <View style={styles.card} key={line.id}>
          <Text style={styles.title}>الصنف {index + 1}</Text>
          <RequestSearchPicker label="الصنف" value={line.item} options={itemOptions} onSelect={row => { void chooseItem(line.id, row); }} onSearchChange={setSearch} loading={items.isLoading} onBarcodePress={() => setScanId(line.id)} />
          <Text style={styles.label}>الوحدة</Text>
          <TouchableOpacity style={styles.secondary} onPress={() => line.units.length > 1 ? setUnitId(line.id) : line.unit ? focusField(line.id, 'quantity') : undefined}><Text style={styles.label}>{line.unit?.label || 'اختر الصنف ثم الوحدة'}</Text></TouchableOpacity>
          <Field label="الكمية" value={line.quantity} onChangeText={quantity => patch(line.id, { quantity })} numeric inputRef={input => { inputRefs.current[`${line.id}:quantity`] = input; }} onFocus={() => revealInput(scrollRef.current, inputRefs.current[`${line.id}:quantity`], 170)} returnKeyType="next" onSubmitEditing={() => focusField(line.id, 'price')} />
          <Field label="سعر الوحدة" value={line.price} onChangeText={price => patch(line.id, { price })} numeric inputRef={input => { inputRefs.current[`${line.id}:price`] = input; }} onFocus={() => revealInput(scrollRef.current, inputRefs.current[`${line.id}:price`], 170)} returnKeyType="done" onSubmitEditing={() => finishLine(line.id)} />
          <TouchableOpacity style={styles.secondary} onPress={() => finishLine(line.id)}><Text style={styles.title}>تم — الصنف التالي</Text></TouchableOpacity>
          {lines.length > 1 && <TouchableOpacity onPress={() => setLines(rows => rows.filter(row => row.id !== line.id))}><Text style={styles.remove}>حذف الصنف</Text></TouchableOpacity>}
        </View>)}
        <TouchableOpacity style={styles.secondary} disabled={lines.length >= 50} onPress={() => setLines(rows => [...rows, blank()])}><Text style={styles.title}>+ إضافة صنف</Text></TouchableOpacity>
        <Field label="ملاحظات" value={notes} onChangeText={setNotes} />
        <Text style={styles.title}>الصافي التقديري: {Number.isFinite(net) ? net.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '—'} {currency}</Text>
        <Text style={styles.notice}>يُحسب الإجمالي النهائي عند الفحص وفق إعدادات Oracle.</Text>
      </View>
      {canManage ? <>
        <TouchableOpacity disabled={busy} style={styles.secondary} onPress={() => { void save(false); }}><Text style={styles.title}>حفظ مسودة</Text></TouchableOpacity>
        <TouchableOpacity disabled={busy} style={styles.button} onPress={() => { void save(true); }}><Text style={styles.buttonText}>{busy ? 'جار الحفظ…' : 'فحص وإرسال عرض السعر'}</Text></TouchableOpacity>
      </> : <Text style={styles.remove}>لا تملك صلاحية إنشاء عروض الأسعار.</Text>}
    </ScrollView>
    <RequestUnitPickerModal visible={!!unitId} itemName={lines.find(line => line.id === unitId)?.item?.label} options={lines.find(line => line.id === unitId)?.units || []} value={lines.find(line => line.id === unitId)?.unit} onClose={() => setUnitId(undefined)} onSelect={unit => {
      const id = unitId; if (!id) return;
      patch(id, { unit }); setUnitId(undefined); focusField(id, 'quantity');
    }} />
    <RequestBarcodeScanner visible={!!scanId} onClose={() => setScanId(undefined)} onScanned={value => { void scan(value); }} />
  </KeyboardAvoidingView>;
}

function Field({ label, numeric, inputRef, ...props }: TextInputProps & { label: string; numeric?: boolean; inputRef?: (input: TextInput | null) => void }) {
  return <View><Text style={styles.label}>{label}</Text><TextInput ref={inputRef} selectTextOnFocus={numeric} blurOnSubmit={false} {...props} style={styles.input} textAlign="right" keyboardType={numeric ? 'decimal-pad' : 'default'} /></View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, content: { padding: 14, gap: 12 },
  card: { padding: 14, backgroundColor: colors.surface, borderRadius: radius.md, marginBottom: 12, borderWidth: 1, borderColor: colors.line },
  title: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 18, textAlign: 'right', marginBottom: 8 },
  label: { fontFamily: 'TajawalBold', color: colors.ink, textAlign: 'right', marginBottom: 5 },
  input: { minHeight: 48, padding: 10, backgroundColor: colors.surface, color: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, marginBottom: 12 },
  notice: { fontFamily: 'TajawalRegular', color: colors.muted, textAlign: 'right', lineHeight: 24, marginBottom: 12 },
  secondary: { padding: 12, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, marginBottom: 12 },
  button: { padding: 16, backgroundColor: colors.primary, borderRadius: radius.md },
  buttonText: { fontFamily: 'TajawalBold', color: '#fff', textAlign: 'center', fontSize: 17 },
  remove: { color: colors.danger, textAlign: 'right', paddingVertical: 8 },
});
