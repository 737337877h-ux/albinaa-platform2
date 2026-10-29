import BarcodeEntrySetting, {useBarcodeEntrySetting} from '../components/barcode-entry-setting';
import {incrementBarcodeLine, barcodeItem} from '../utils/barcode-lines';
import React from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchTransferItem, fetchTransferWarehouses, searchTransferItems } from '../api/endpoints';
import { getClient } from '../api/client';
import { useAuth } from '../store/auth-context';
import RequestBarcodeScanner from '../components/request-barcode-scanner';
import RequestSearchPicker, { RequestPickerOption } from '../components/request-search-picker';
import RequestUnitPickerModal from '../components/request-unit-picker-modal';
import { getCustomerOptionsOffline } from '../db/database';
import { useSync } from '../store/sync-context';
import { colors, radius, shadow } from '../theme';
import { parseFlexibleDate } from '../utils/date-input';
import { saveOfflineDraft, submitOfflineDraft } from '../utils/offline-request';
import { revealInput } from '../utils/keyboard';

type OrderKind = 'cash' | 'credit';
type SaveMode = 'draft' | 'submit';
type OrderLine = {
  id: string;
  item?: RequestPickerOption;
  unit?: RequestPickerOption;
  units: RequestPickerOption[];
  quantity: string;
  unitPrice: string;
  expanded: boolean;
};

const newLine = (): OrderLine => ({ id: `${Date.now()}-${Math.random()}`, units: [], quantity: '1', unitPrice: '0', expanded: true });
const today = () => new Date().toISOString().slice(0, 10);
const amount = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value || 0);

export default function NewCustomerOrderScreen({ navigation, route }: any) {
  const {automatic,keyboardVisible,setAutomatic}=useBarcodeEntrySetting();
  const draft=route.params?.draftPayload as any|undefined;
  const [draftId]=React.useState(()=>String(route.params?.draftOperationId||`customer_order:${Date.now()}:${Math.random().toString(36).slice(2,10)}`));
  const {user}=useAuth();
  const scope=user?`${user.organizationId}:${user.id}`:'';
  const savingLock=React.useRef(false);
  const restoredLines=React.useMemo(()=>Array.isArray(draft?.lines)&&draft.lines.length?draft.lines.map((row:any,index:number)=>{const item={key:String(row.itemCode||''),label:String(row.itemName||row.itemCode||'صنف'),hint:String(row.itemCode||'')};const unit={key:String(row.unitCode||''),label:String(row.unitName||row.unitCode||'الوحدة')};return{id:`draft-${index}-${row.itemCode}`,item,unit,units:[unit],quantity:String(row.quantity??1),unitPrice:String(row.unitPrice??0),expanded:true} as OrderLine;}):[newLine()],[]);
  const insets = useSafeAreaInsets();
  const { triggerSync } = useSync();
  const [orderKind, setOrderKind] = React.useState<OrderKind>(draft?.orderKind==='credit'?'credit':'cash');
  const [cashName, setCashName] = React.useState(String(draft?.orderKind==='cash'?draft?.customerName||'':''));
  const [creditCustomer, setCreditCustomer] = React.useState<RequestPickerOption|undefined>(draft?.orderKind==='credit'&&draft?.customerCode?{key:String(draft.customerCode),label:String(draft.customerName||draft.customerCode),hint:String(draft.customerCode)}:undefined);
  const [currencyCode, setCurrencyCode] = React.useState<'YR' | 'SR' | '$'>(['YR','SR','$'].includes(draft?.currencyCode)?draft.currencyCode:'YR');
  const [orderDate, setOrderDate] = React.useState(String(draft?.orderDate||today()));
  const [warehouse, setWarehouse] = React.useState<RequestPickerOption|undefined>(draft?.lines?.[0]?.warehouseCode?{key:String(draft.lines[0].warehouseCode),label:String(draft.lines[0].warehouseName||draft.lines[0].warehouseCode)}:undefined);
  const [notes, setNotes] = React.useState(String(draft?.notes||'طلب عميل من تطبيق البناء الراقي'));
  const [lines, setLines] = React.useState<OrderLine[]>(restoredLines);
  const [itemSearch, setItemSearch] = React.useState('');
  const [scanLineId, setScanLineId] = React.useState<string>();
  const [unitLineId, setUnitLineId] = React.useState<string>();
  const [saving, setSaving] = React.useState(false);
  const quantityRefs = React.useRef<Record<string, TextInput | null>>({});
  const priceRefs = React.useRef<Record<string, TextInput | null>>({});
  const scrollRef = React.useRef<ScrollView | null>(null);
  const deferredSearch = React.useDeferredValue(itemSearch);

  const customers = useQuery({ queryKey: ['customer-order-local-customers'], queryFn: getCustomerOptionsOffline });
  const warehouses = useQuery({ queryKey: ['request-warehouses'], queryFn: async () => (await fetchTransferWarehouses()).data });
  const items = useQuery({ queryKey: ['request-items', deferredSearch], queryFn: async () => (await searchTransferItems(deferredSearch)).data });
  const customerOptions = (customers.data || []).flatMap((row: any) => {
    const code = String(row.externalCustomerCode || row.accountNumber || '').trim();
    return code ? [{ key: code, label: row.fullName || code, hint: code, raw: row }] : [];
  });
  const warehouseOptions = ((warehouses.data?.items ?? warehouses.data ?? []) as any[]).map((row) => ({
    key: String(row.externalWarehouseCode ?? row.code), label: row.nameAr ?? row.name ?? row.code,
    hint: String(row.externalWarehouseCode ?? row.code), raw: row,
  }));
  const itemOptions = ((items.data?.items ?? items.data ?? []) as any[]).map((row) => {
    const code = String(row.externalItemCode ?? row.itemCode);
    return { key: code, label: row.nameAr ?? row.itemName ?? code, hint: code, raw: row };
  });

  React.useEffect(() => {
    if (!warehouse && warehouseOptions.length) {
      setWarehouse(warehouseOptions.find((option) => option.key === '102') || warehouseOptions[0]);
    }
  }, [warehouse, warehouseOptions]);

  const totalQuantity = lines.reduce((sum, line) => sum + (line.item ? Number(line.quantity) || 0 : 0), 0);
  const totalAmount = lines.reduce((sum, line) => sum + (line.item ? (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0) : 0), 0);
  const patchLine = (id: string, change: Partial<OrderLine>) => setLines((rows) => rows.map((line) => line.id === id ? { ...line, ...change } : line));
  const focusQuantity = (id: string) => setTimeout(() => revealInput(scrollRef.current, quantityRefs.current[id], 190), 180);
  const focusPrice = (id: string) => setTimeout(() => revealInput(scrollRef.current, priceRefs.current[id], 190), 120);

  const selectItem = async (id: string, option: RequestPickerOption) => {
    try {
      const detail = (await fetchTransferItem(option.key)).data;
      const units = ((detail.units ?? []) as any[]).filter((row) => row.isInactive !== true).map((row) => ({
        key: String(row.unitName ?? row.unitCode), label: String(row.unitName ?? row.unitCode),
        hint: row.packageSize ? `حجم العبوة ${row.packageSize}` : undefined, raw: row,
      }));
      if (!units.length) return Alert.alert('لا توجد وحدة مفعلة', 'لا توجد وحدة صالحة لهذا الصنف في البيانات المحلية.');
      patchLine(id, { item: { ...option, raw: { ...(option.raw as any), ...detail } }, units, unit: units.length === 1 ? units[0] : undefined, expanded: true });
      if (units.length > 1) setUnitLineId(id); else focusQuantity(id);
    } catch {
      Alert.alert('تعذر تحميل الصنف', 'الصنف غير موجود في القاعدة المحلية. أعد المزامنة عند توفر الاتصال.');
    }
  };

  const incrementExisting=(code:string)=>{const matches=lines.filter(line=>line.item?.key===code);if(!matches.length)return false;if(matches.length>1){Alert.alert('اختر السطر','الصنف موجود بأكثر من وحدة أو سعر؛ عدّل كمية السطر المطلوب.');return true;}const target=matches[0];setLines(rows=>incrementBarcodeLine(rows,target.id));focusQuantity(target.id);return true;};
  const acceptBarcode = async (value: string) => {
    const id = scanLineId; setScanLineId(undefined); if (!id) return;
    try {const response = (await searchTransferItems(value)).data;
    const rows = (response?.items ?? response ?? []) as any[];
    const match = barcodeItem(rows,value);
    if (!match) return Alert.alert('باركود غير معروف', 'لم يُعثر على الصنف في القاعدة المحلية.');
    if(incrementExisting(String(match.externalItemCode??match.itemCode)))return;patchLine(id,{quantity:'1'});await selectItem(id, { key: String(match.externalItemCode ?? match.itemCode), label: match.nameAr ?? match.itemName ?? value, hint: value, raw: match });}catch{Alert.alert('تعذر قراءة الصنف','تحقق من الاتصال أو أعد مزامنة الأصناف.');}
  };

  const finishLine = (id: string) => {
    const current = lines.find((line) => line.id === id);
    if (!current?.item || !current.unit || !(Number(current.quantity) > 0) || Number(current.unitPrice) < 0) {
      return Alert.alert('أكمل السطر', 'اختر الوحدة وأدخل الكمية والسعر قبل الانتقال للصنف التالي.');
    }
    const existing = lines.find((line) => line.id !== id && !line.item);
    const next = existing ?? newLine();
    setLines((rows) => {
      const updated = rows.map((line) => line.id === id ? { ...line, expanded: false } : line);
      return existing ? updated : [...updated, next];
    });
    Keyboard.dismiss();if(automatic)setTimeout(() => setScanLineId(next.id), 220);
  };

  const buildPayload = () => {
    const customerName = orderKind === 'cash' ? cashName.trim() : creditCustomer?.label.trim();
    const customerCode = orderKind === 'credit' ? creditCustomer?.key.trim() : undefined;
    const parsedDate = parseFlexibleDate(orderDate);
    if (!customerName) { Alert.alert('اسم العميل مطلوب', orderKind === 'cash' ? 'أدخل اسم العميل النقدي.' : 'اختر العميل الآجل.'); return null; }
    if (orderKind === 'credit' && !customerCode) { Alert.alert('رقم العميل مطلوب', 'الطلب الآجل يجب أن يرتبط برقم العميل.'); return null; }
    if (!parsedDate) { Alert.alert('تاريخ الطلب غير صحيح', 'يمكن إدخال 308 ليصبح 30/08 من السنة الحالية.'); return null; }
    if (!warehouse) { Alert.alert('المخزن مطلوب', 'اختر مخزن الطلب.'); return null; }
    const filledLines=lines.filter(line=>line.item||line.unit||line.quantity!=='1'||line.unitPrice!=='0');
    if (!filledLines.length || filledLines.some((line) => !line.item || !line.unit || !(Number(line.quantity) > 0) || !Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0)) {
      Alert.alert('بيانات الأصناف ناقصة', 'أكمل الصنف والوحدة والكمية والسعر لكل صنف.'); return null;
    }
    setOrderDate(parsedDate.iso);
    return {
      orderKind, customerCode, customerName, currencyCode, orderDate: parsedDate.iso, notes: notes.trim() || undefined,
      lines: filledLines.map((line) => ({
        itemCode: line.item!.key, itemName: line.item!.label, unitCode: line.unit!.key,
        warehouseCode: warehouse.key, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice),
      })),
    };
  };

  const save = async (mode: SaveMode) => {
    if(savingLock.current)return;
    if(!scope||!user?.permissions?.includes('sales_order_drafts.manage'))return Alert.alert('غير متاح','صلاحية إنشاء طلب العميل مطلوبة');
    const payload = buildPayload(); if (!payload) return;
    savingLock.current=true;
    setSaving(true);
    let checkedOnline = false;
    try {
      if (mode === 'submit') {
        try {
          const client=await getClient();
          const result = (await client.post('/customer-orders/dry-run',{...payload,externalReference:draftId},{timeout:120000})).data;
          checkedOnline = true;
          if (!result?.valid) {
            Alert.alert('لم يجتز الطلب الفحص', 'تعذر تأكيد صلاحية بيانات الطلب؛ راجع البيانات ثم أعد الفحص.');
            return;
          }
        } catch (error: any) {
          if (error?.response) {
            Alert.alert('تعذر فحص الطلب', error.response?.data?.message || 'راجع بيانات الطلب ثم أعد المحاولة.');
            return;
          }
        }
      }
      if(mode==='draft') await saveOfflineDraft({ kind: 'customer_order', title: 'طلب عميل قبل الفاتورة', endpoint: '/customer-orders', operationId:draftId, payload:{...payload,__oracleScope:scope,__offlineWorkflow:'oracle-sales-order-submit'} });
      else { await submitOfflineDraft({ kind: 'customer_order', title: 'طلب عميل في Oracle', endpoint: '/customer-orders', operationId:draftId, payload:{...payload,__oracleScope:scope,__offlineWorkflow:'oracle-sales-order-submit'} }); void triggerSync().catch(() => undefined); }
      const message = mode === 'draft'
        ? 'حُفظت المسودة في قاعدة الهاتف فقط. يمكنك فتحها وتعديلها أو حذفها من عمليات ONYX.'
        : checkedOnline
          ? 'اجتاز الطلب الفحص وأُضيف لقائمة الإرسال إلى Oracle. تابع حالة الإرسال في عمليات ONYX، وبعد نجاحه سيظهر رقم الطلب في طلبات العملاء.'
          : 'حُفظ الطلب محليًا وسيُرسل إلى Oracle عند عودة الاتصال. تابع حالة الإرسال في عمليات ONYX، وبعد نجاحه سيظهر في طلبات العملاء.';
      Alert.alert('تم حفظ طلب العميل', message, [{ text: 'حسنًا', onPress: () => navigation.goBack() }]);
    } catch(error:any){Alert.alert('تعذر حفظ الطلب',error?.response?.data?.message||error?.message||'أعد المحاولة بنفس الطلب');}
    finally { savingLock.current=false;setSaving(false); }
  };

  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={70}>
    <ScrollView ref={scrollRef} contentContainerStyle={[styles.content, { paddingBottom: 230 + Math.max(insets.bottom, 12) }]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
<BarcodeEntrySetting value={automatic} onChange={setAutomatic}/>
      <View style={styles.draftBadge}><Ionicons name="checkmark-circle" size={18} color={colors.success} /><Text style={styles.draftText}>مسودة طلب غير معتمد</Text></View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>رأس الطلب</Text>
        <Text style={styles.label}>نوع الطلب</Text>
        <View style={styles.segment}>{(['cash', 'credit'] as OrderKind[]).map((kind) => <TouchableOpacity key={kind} style={[styles.segmentButton, orderKind === kind && styles.segmentActive]} onPress={() => setOrderKind(kind)}><Text style={[styles.segmentText, orderKind === kind && styles.segmentTextActive]}>{kind === 'cash' ? 'نقدي' : 'آجل'}</Text></TouchableOpacity>)}</View>
        {orderKind === 'cash'
          ? <Field label="العميل" value={cashName} onChangeText={setCashName} placeholder="اسم العميل النقدي" />
          : <RequestSearchPicker label="العميل" value={creditCustomer} options={customerOptions} onSelect={setCreditCustomer} placeholder="اختر الاسم ورقم العميل" loading={customers.isLoading} />}
        <View style={styles.headerGrid}>
          <View style={styles.dateCell}><Field label="التاريخ" value={orderDate} onChangeText={setOrderDate} onBlur={() => { const parsed = parseFlexibleDate(orderDate); if (parsed) setOrderDate(parsed.iso); }} placeholder="308 أو 2026-08-30" /></View>
          <View style={styles.currencyCell}><Text style={styles.label}>العملة</Text><View style={styles.currencyRow}>{([['YR', 'YER'], ['SR', 'SAR'], ['$', 'USD']] as const).map(([code, label]) => <TouchableOpacity key={code} style={[styles.currencyButton, currencyCode === code && styles.currencyActive]} onPress={() => setCurrencyCode(code)}><Text style={[styles.currencyText, currencyCode === code && styles.currencyTextActive]}>{label}</Text></TouchableOpacity>)}</View></View>
        </View>
        <RequestSearchPicker label="المخزن" value={warehouse} options={warehouseOptions} onSelect={setWarehouse} placeholder="102 - الفرع" loading={warehouses.isLoading} />
      </View>

      <Text style={styles.outsideTitle}>الأصناف المضافة</Text>
      {lines.map((line, index) => !line.expanded && line.item ? <TouchableOpacity key={line.id} style={[styles.itemCard, styles.collapsedItem]} onPress={() => patchLine(line.id, { expanded: true })}>
        <Ionicons name="create-outline" size={20} color={colors.primary} />
        <View style={styles.itemHeading}><Text numberOfLines={2} style={styles.itemName}>{index + 1}. {line.item.label}</Text><Text style={styles.itemCode}>{line.quantity} {line.unit?.label ?? ''} × {amount(Number(line.unitPrice))} {currencyCode}</Text></View>
        <Ionicons name="checkmark-circle" size={22} color={colors.success} />
      </TouchableOpacity> : <View key={line.id} style={styles.itemCard}>
        <View style={styles.cardHead}>
          <View style={styles.cardActions}>
            <TouchableOpacity accessibilityLabel="قراءة باركود الصنف" style={styles.iconButton} onPress={() => setScanLineId(line.id)}><Ionicons name="camera-outline" size={19} color={colors.primary} /></TouchableOpacity>
            <TouchableOpacity accessibilityLabel="حذف الصنف" style={styles.iconButton} onPress={() => lines.length > 1 ? setLines((rows) => rows.filter((row) => row.id !== line.id)) : patchLine(line.id, { item: undefined, unit: undefined, units: [] })}><Ionicons name="close" size={20} color={colors.danger} /></TouchableOpacity>
          </View>
          <View style={styles.itemHeading}><Text numberOfLines={2} style={styles.itemName}>{index + 1}. {line.item?.label || 'اختر الصنف'}</Text>{line.item ? <Text style={styles.itemCode}>الكود: {line.item.key}</Text> : null}</View>
        </View>
        <RequestSearchPicker label="بحث الصنف" value={line.item} options={itemOptions} onSearchChange={setItemSearch} onSelect={(item) => selectItem(line.id, item)} onBarcodePress={() => setScanLineId(line.id)} placeholder="بالاسم أو الكود أو الباركود" loading={items.isLoading} />
        <View style={styles.lineGrid}>
          <View style={styles.lineCell}><Text style={styles.label}>الوحدة</Text><TouchableOpacity style={styles.unitButton} onPress={() => line.units.length > 1 ? setUnitLineId(line.id) : focusQuantity(line.id)}><Ionicons name="chevron-down" size={17} color={colors.muted} /><Text style={[styles.unitText, !line.unit && styles.unitPlaceholder]}>{line.unit?.label ?? 'اختر الوحدة'}</Text></TouchableOpacity></View>
          <View style={styles.lineCell}><Field label="السعر" value={line.unitPrice} onChangeText={(unitPrice) => patchLine(line.id, { unitPrice })} numeric inputRef={(input) => { priceRefs.current[line.id] = input; }} onFocus={() => revealInput(scrollRef.current, priceRefs.current[line.id], 190)} returnKeyType="done" onSubmitEditing={() => finishLine(line.id)} /></View>
          <View style={styles.qtyCell}><Field label="الكمية" value={line.quantity} onChangeText={(quantity) => patchLine(line.id, { quantity })} numeric inputRef={(input) => { quantityRefs.current[line.id] = input; }} onFocus={() => revealInput(scrollRef.current, quantityRefs.current[line.id], 190)} returnKeyType="next" onSubmitEditing={() => focusPrice(line.id)} /></View>
        </View>
      </View>)}
      <TouchableOpacity style={styles.add} onPress={() => setLines((rows) => [...rows, newLine()])}><Ionicons name="add-circle-outline" size={20} color={colors.primary} /><Text style={styles.addText}>إضافة صنف جديد (بحث بالاسم، الكود أو الباركود)</Text></TouchableOpacity>

      <View style={styles.summary}>
        <Text style={styles.sectionTitle}>ملخص الطلب النهائي</Text>
        <View style={styles.summaryRow}><View style={styles.summaryItem}><Text style={styles.summaryLabel}>إجمالي الكميات</Text><Text style={styles.summaryValue}>{amount(totalQuantity)}</Text></View><View style={styles.summaryDivider} /><View style={styles.summaryItem}><Text style={styles.summaryLabel}>صافي المبلغ</Text><Text style={styles.summaryValue}>{amount(totalAmount)} {currencyCode}</Text></View></View>
      </View>
      <Field label="البيان والملاحظات" value={notes} onChangeText={setNotes} />
      <Text style={styles.safety}>يرسل إلى Oracle كطلب غير معتمد. الطلب الآجل يخضع لفحص الائتمان.</Text>
    </ScrollView>

    <View style={[styles.footer, keyboardVisible&&{display:'none'}, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <TouchableOpacity disabled={saving} style={[styles.secondarySave, saving && styles.disabled]} onPress={() => save('draft')}><Text style={styles.secondarySaveText}>حفظ مسودة</Text></TouchableOpacity>
      <TouchableOpacity disabled={saving} style={[styles.primarySave, saving && styles.disabled]} onPress={() => save('submit')}><Text style={styles.primarySaveText}>{saving ? 'جار الحفظ…' : 'فحص وإرسال الطلب'}</Text></TouchableOpacity>
    </View>
    <RequestBarcodeScanner visible={Boolean(scanLineId)} onClose={() => setScanLineId(undefined)} onScanned={acceptBarcode} />
    <RequestUnitPickerModal visible={Boolean(unitLineId)} itemName={lines.find((line) => line.id === unitLineId)?.item?.label} options={lines.find((line) => line.id === unitLineId)?.units ?? []} value={lines.find((line) => line.id === unitLineId)?.unit} onClose={() => setUnitLineId(undefined)} onSelect={(unit) => { const id = unitLineId; if (!id) return; patchLine(id, { unit }); setUnitLineId(undefined); focusQuantity(id); }} />
  </KeyboardAvoidingView>;
}

function Field({ label, value, onChangeText, placeholder, numeric = false, onBlur, onFocus, inputRef, returnKeyType, onSubmitEditing }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; numeric?: boolean; onBlur?: () => void; onFocus?:()=>void; inputRef?:(input:TextInput|null)=>void; returnKeyType?:'next'|'done'; onSubmitEditing?:()=>void }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput ref={inputRef} value={value} onChangeText={onChangeText} onBlur={onBlur} onFocus={onFocus} placeholder={placeholder} placeholderTextColor={colors.muted} keyboardType={numeric ? 'decimal-pad' : 'default'} enterKeyHint={returnKeyType} returnKeyType={returnKeyType} blurOnSubmit={false} onSubmitEditing={onSubmitEditing} selectTextOnFocus={numeric} textAlign="right" style={styles.input} /></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 12 },
  draftBadge: { minHeight: 42, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: radius.md, backgroundColor: colors.primarySoft, marginBottom: 10 },
  draftText: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.success, fontWeight: '900' },
  sectionCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 12, marginBottom: 12, ...shadow },
  sectionTitle: { fontFamily: 'TajawalBold', color: colors.ink, textAlign: 'right', fontWeight: '900', fontSize: 18, marginBottom: 10 },
  outsideTitle: { fontFamily: 'TajawalBold', color: colors.ink, textAlign: 'right', fontWeight: '900', fontSize: 18, marginVertical: 8 },
  label: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.ink, textAlign: 'right', fontWeight: '900', marginBottom: 6 },
  field: { flex: 1, marginBottom: 10 },
  input: { minHeight: 50, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.surface, color: colors.ink, paddingHorizontal: 12 },
  segment: { flexDirection: 'row-reverse', gap: 7, marginBottom: 12 },
  segmentButton: { flex: 1, minHeight: 43, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.ink, fontWeight: '900' },
  segmentTextActive: { color: '#fff' },
  headerGrid: { flexDirection: 'row-reverse', gap: 8, alignItems: 'flex-start' },
  dateCell: { flex: 1.05 },
  currencyCell: { flex: 1.45 },
  currencyRow: { flexDirection: 'row-reverse', gap: 4 },
  currencyButton: { flex: 1, minHeight: 50, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  currencyActive: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  currencyText: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 13, fontWeight: '900' },
  currencyTextActive: { color: colors.primary },
  itemCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 10, marginBottom: 10, ...shadow },
  collapsedItem:{minHeight:66,flexDirection:'row-reverse',alignItems:'center',gap:9},
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 5 },
  cardActions: { flexDirection: 'row', gap: 5 },
  iconButton: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  itemHeading: { flex: 1 },
  itemName: { fontFamily: 'TajawalBold', color: colors.ink, textAlign: 'right', fontWeight: '900', fontSize: 16 },
  itemCode: { fontFamily: 'TajawalRegular', color: colors.muted, textAlign: 'right', fontSize: 13, marginTop: 3 },
  lineGrid: { flexDirection: 'row-reverse', gap: 7, alignItems: 'flex-start' },
  lineCell: { flex: 1 },
  qtyCell: { width: 82 },
  unitButton:{minHeight:50,flexDirection:'row',alignItems:'center',gap:7,borderWidth:1,borderColor:colors.line,borderRadius:radius.sm,paddingHorizontal:10,backgroundColor:colors.surface},unitText:{ fontFamily: 'TajawalBold', fontSize: 15,flex:1,color:colors.ink,textAlign:'right',fontWeight:'800'},unitPlaceholder:{color:colors.muted},
  add: { minHeight: 52, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.surface },
  addText: { fontFamily: 'TajawalBold', color: colors.primary, fontWeight: '900', fontSize: 13 },
  summary: { backgroundColor: colors.goldSoft, borderRadius: radius.md, borderWidth: 1, borderColor: colors.gold, padding: 12, marginVertical: 12 },
  summaryRow: { flexDirection: 'row-reverse', alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, height: 44, backgroundColor: colors.gold },
  summaryLabel: { fontFamily: 'TajawalBold', color: colors.muted, fontSize: 13, fontWeight: '800' },
  summaryValue: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 18, fontWeight: '900', marginTop: 4 },
  safety: { color: colors.muted, textAlign: 'center', lineHeight: 20, marginBottom: 5 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 9, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: 'row-reverse', gap: 8 },
  primarySave: { flex: 1.35, minHeight: 52, borderRadius: radius.sm, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primarySaveText: { fontFamily: 'TajawalBold', color: '#fff', fontWeight: '900', fontSize: 15 },
  secondarySave: { flex: 1, minHeight: 52, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  secondarySaveText: { fontFamily: 'TajawalBold', color: colors.primary, fontWeight: '900', fontSize: 15 },
  disabled: { opacity: 0.5 },
});
