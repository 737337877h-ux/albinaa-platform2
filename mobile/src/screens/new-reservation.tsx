import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import CustomerPicker from '../components/customer-picker';
import { createReservation, fetchCurrencies, fetchReservationUnits } from '../api/endpoints';
import { enqueueMutation, getReferenceOptions } from '../db/database';
import { useSync } from '../store/sync-context';
import { apiErrorMessage } from '../utils/errors';
import { colors, radius, shadow } from '../theme';

export default function NewReservationScreen({ route, navigation }: any) {
  const [customerId, setCustomerId] = useState(route.params?.customerId || '');
  const [customerName, setCustomerName] = useState(route.params?.customerName || '');
  const [itemName, setItemName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitId, setUnitId] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [currencyCode, setCurrencyCode] = useState('YER');
  const [warehouse, setWarehouse] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [notes, setNotes] = useState('');
  const queryClient = useQueryClient();
  const { triggerSync } = useSync();

  const unitsQuery = useQuery({
    queryKey: ['reservation-units'],
    queryFn: async () => {
      try { return (await fetchReservationUnits()).data || []; }
      catch { return getReferenceOptions('reservationUnits'); }
    },
  });
  const currenciesQuery = useQuery({
    queryKey: ['currencies'],
    queryFn: async () => {
      try { return (await fetchCurrencies()).data || []; }
      catch { return getReferenceOptions('currencies'); }
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const qty = Number(quantity);
      const price = Number(unitPrice);
      if (!customerId) throw new Error('اختر العميل');
      if (!itemName.trim()) throw new Error('أدخل اسم الصنف');
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('أدخل كمية صحيحة أكبر من صفر');
      if (!unitId) throw new Error('اختر وحدة القياس');
      if (!Number.isFinite(price) || price <= 0) throw new Error('أدخل سعر وحدة صحيحًا');
      const payload = {
        customerId,
        itemName: itemName.trim(),
        quantity: qty,
        unitId,
        unitPrice: price,
        currencyCode,
        warehouse: warehouse.trim() || undefined,
        documentNumber: documentNumber.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      try {
        return await createReservation(payload);
      } catch (error: any) {
        if (!error?.response) {
          const operationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          await enqueueMutation(operationId, 'POST', '/reservations', payload);
          return { data: { id: operationId, offline: true } };
        }
        throw error;
      }
    },
    onSuccess: async (response: any) => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await triggerSync();
      Alert.alert('تم', response?.data?.offline ? 'تم حفظ الحجز على الهاتف وسيُزامن عند توفر الاتصال' : 'تمت إضافة الحجز بنجاح');
      navigation.goBack();
    },
    onError: (error: any) => Alert.alert('تعذر إضافة الحجز', apiErrorMessage(error, 'راجع البيانات وحاول مرة أخرى')),
  });

  const units = unitsQuery.data || [];
  const currencies = currenciesQuery.data || [];
  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <CustomerPicker selectedId={customerId} selectedName={customerName} onSelect={(customer) => { setCustomerId(customer.id); setCustomerName(customer.fullName); }} />
        <Field label="اسم الصنف *" value={itemName} onChangeText={setItemName} placeholder="مثال: حديد تسليح 12 ملم" />
        <View style={styles.twoColumns}>
          <View style={styles.column}><Field label="الكمية *" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" /></View>
          <View style={styles.column}><Field label="سعر الوحدة *" value={unitPrice} onChangeText={setUnitPrice} keyboardType="decimal-pad" /></View>
        </View>
        <Text style={styles.label}>وحدة القياس *</Text>
        {unitsQuery.isLoading ? <ActivityIndicator color={colors.goldDark} /> : units.length === 0 ? <Text style={styles.warning}>تعذر تحميل وحدات القياس</Text> : (
          <View style={styles.options}>{units.map((unit: any) => <Option key={unit.id} active={unitId === unit.id} label={`${unit.nameAr || unit.name}${unit.weightKg == null ? '' : ` · ${unit.weightKg} كجم`}`} onPress={() => setUnitId(unit.id)} />)}</View>
        )}
        <Text style={styles.label}>العملة *</Text>
        <View style={styles.options}>{currencies.map((currency: any) => <Option key={currency.code} active={currencyCode === currency.code} label={currency.code} onPress={() => setCurrencyCode(currency.code)} />)}</View>
        <Field label="المستودع (اختياري)" value={warehouse} onChangeText={setWarehouse} />
        <Field label="رقم المستند (اختياري)" value={documentNumber} onChangeText={setDocumentNumber} />
        <Text style={styles.label}>ملاحظات</Text>
        <TextInput style={styles.notes} value={notes} onChangeText={setNotes} multiline textAlign="right" placeholder="أي تفاصيل إضافية..." placeholderTextColor={colors.muted} />
        <TouchableOpacity style={[styles.submit, mutation.isPending && styles.disabled]} disabled={mutation.isPending} onPress={() => mutation.mutate()}>
          <Text style={styles.submitText}>{mutation.isPending ? 'جارٍ الحفظ...' : 'حفظ الحجز'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field(props: any) {
  const { label, ...inputProps } = props;
  return <><Text style={styles.label}>{label}</Text><TextInput style={styles.input} textAlign="right" placeholderTextColor={colors.muted} {...inputProps} /></>;
}
function Option({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return <TouchableOpacity style={[styles.option, active && styles.optionActive]} onPress={onPress}><Text style={[styles.optionText, active && styles.optionTextActive]}>{label}</Text></TouchableOpacity>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 50 },
  label: { fontSize: 14, fontWeight: '800', color: colors.ink, textAlign: 'right', marginTop: 16, marginBottom: 7 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 13, color: colors.ink, fontSize: 15 },
  twoColumns: { flexDirection: 'row-reverse', gap: 10 },
  column: { flex: 1 },
  options: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  option: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12 },
  optionActive: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  optionText: { color: colors.ink, fontWeight: '700' },
  optionTextActive: { color: colors.primary, fontWeight: '900' },
  notes: { minHeight: 90, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 13, color: colors.ink, textAlignVertical: 'top' },
  warning: { color: colors.warning, backgroundColor: colors.goldSoft, padding: 12, borderRadius: radius.sm, textAlign: 'right' },
  submit: { backgroundColor: colors.gold, borderRadius: radius.md, padding: 16, alignItems: 'center', marginTop: 26, ...shadow },
  disabled: { opacity: 0.55 },
  submitText: { color: colors.primary, fontSize: 16, fontWeight: '900' },
});
