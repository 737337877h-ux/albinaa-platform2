import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import CustomerPicker from '../components/customer-picker';
import { createReservation } from '../api/endpoints';
import { enqueueMutation } from '../db/database';
import { useSync } from '../store/sync-context';
import { apiErrorMessage } from '../utils/errors';
import { colors, radius, shadow } from '../theme';
import { generateIdempotencyKey } from '../utils/constants';

export default function NewReservationScreen({ route, navigation }: any) {
  const [customerId, setCustomerId] = useState(route.params?.customerId || '');
  const [customerName, setCustomerName] = useState(route.params?.customerName || '');
  const [totalTons, setTotalTons] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [currencyCode, setCurrencyCode] = useState<'YER' | 'SAR'>('YER');
  const [documentNumber, setDocumentNumber] = useState('');
  const [notes, setNotes] = useState('');
  const queryClient = useQueryClient();
  const { triggerSync } = useSync();
  const request = React.useRef({ payload: '', operationId: '' });

  const mutation = useMutation({
    mutationFn: async () => {
      const tons = Number(totalTons);
      const price = Number(unitPrice);
      if (!customerId) throw new Error('اختر العميل');
      if (!Number.isFinite(tons) || tons <= 0) throw new Error('أدخل إجمالي الحجز بالطن');
      if (!Number.isFinite(price) || price <= 0) throw new Error('أدخل سعر الطن');
      const payload = {
        customerId,
        totalTons: tons,
        unitPrice: price,
        currencyCode,
        documentNumber: documentNumber.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      const serialized = JSON.stringify(payload);
      if (request.current.payload !== serialized) request.current = { payload: serialized, operationId: generateIdempotencyKey() };
      const operationId = request.current.operationId;
      try {
        return await createReservation(payload, operationId);
      } catch (error: any) {
        if (!error?.response) {
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

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <CustomerPicker selectedId={customerId} selectedName={customerName} onSelect={(customer) => { setCustomerId(customer.id); setCustomerName(customer.fullName); }} />
        <View style={styles.notice}><Text style={styles.noticeText}>الحجز إجمالي بالطن فقط. لا يلزم اختيار الصنف الآن؛ يُحتسب الصنف تلقائيًا عند الفوترة.</Text></View>
        <Field label="إجمالي الحجز بالطن *" value={totalTons} onChangeText={setTotalTons} keyboardType="decimal-pad" placeholder="مثال: 6" />
        <Field label="سعر الطن *" value={unitPrice} onChangeText={setUnitPrice} keyboardType="decimal-pad" placeholder="مثال: 385000" />
        <Text style={styles.label}>عملة الحجز *</Text>
        <View style={styles.currencyRow}>
          {([['YER', 'ريال يمني'], ['SAR', 'ريال سعودي']] as const).map(([code, label]) => <TouchableOpacity key={code} style={[styles.currencyButton, currencyCode === code && styles.currencyButtonActive]} onPress={() => setCurrencyCode(code)}><Text style={[styles.currencyText, currencyCode === code && styles.currencyTextActive]}>{label}</Text><Text style={[styles.currencyCode, currencyCode === code && styles.currencyTextActive]}>{code}</Text></TouchableOpacity>)}
        </View>
        {Number(totalTons) > 0 && Number(unitPrice) > 0 && <View style={styles.totalCard}><Text style={styles.totalLabel}>إجمالي قيمة الحجز</Text><Text style={styles.totalValue}>{new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(Number(totalTons) * Number(unitPrice))} {currencyCode}</Text></View>}
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
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 50 },
  label: { fontFamily: 'TajawalBold', fontSize: 15, fontWeight: '800', color: colors.ink, textAlign: 'right', marginTop: 16, marginBottom: 7 },
  input: { fontFamily: 'TajawalRegular', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 13, color: colors.ink, fontSize: 16 },
  notice: { backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 12 },
  noticeText: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.ink, textAlign: 'right', fontWeight: '800', lineHeight: 21 },
  currencyRow: { flexDirection: 'row-reverse', gap: 10 },
  currencyButton: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, backgroundColor: colors.surface, alignItems: 'center' },
  currencyButtonActive: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  currencyText: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.ink, fontWeight: '800' },
  currencyCode: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, marginTop: 2 },
  currencyTextActive: { color: colors.primary },
  totalCard: { marginTop: 14, borderRadius: radius.md, backgroundColor: colors.primarySoft, padding: 14 },
  totalLabel: { fontFamily: 'TajawalRegular', textAlign: 'right', color: colors.muted, fontSize: 13 },
  totalValue: { fontFamily: 'TajawalBold', textAlign: 'right', color: colors.primary, fontSize: 20, fontWeight: '900', marginTop: 4 },
  notes: { minHeight: 90, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 13, color: colors.ink, textAlignVertical: 'top' },
  warning: { color: colors.warning, backgroundColor: colors.goldSoft, padding: 12, borderRadius: radius.sm, textAlign: 'right' },
  submit: { backgroundColor: colors.gold, borderRadius: radius.md, padding: 16, alignItems: 'center', marginTop: 26, ...shadow },
  disabled: { opacity: 0.55 },
  submitText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 16, fontWeight: '900' },
});
