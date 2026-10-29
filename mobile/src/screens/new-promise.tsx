import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createPromise, fetchCurrencies } from '../api/endpoints';
import { enqueueMutation, getReferenceOptions } from '../db/database';
import { getCurrentPosition } from '../utils/gps';
import { saveGpsPoint } from '../db/database';
import { apiErrorMessage } from '../utils/errors';
import { useSync } from '../store/sync-context';
import CustomerPicker from '../components/customer-picker';
import { colors, radius, shadow } from '../theme';
import { displayDateFromIso, parseFlexibleDate } from '../utils/date-input';

export default function NewPromiseScreen({ route, navigation }: any) {
  const presetCustomerId = route.params?.customerId || '';
  const presetCustomerName = route.params?.customerName || '';
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('YER');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return displayDateFromIso(d.toISOString().split('T')[0]);
  });
  const [notes, setNotes] = useState('');
  const [customerId, setCustomerId] = useState(presetCustomerId);
  const [customerName, setCustomerName] = useState(presetCustomerName);
  const queryClient = useQueryClient();
  const { triggerSync } = useSync();
  const { data: currencies } = useQuery({
    queryKey: ['currencies'],
    queryFn: async () => {
      try { return (await fetchCurrencies()).data || []; }
      catch { return getReferenceOptions('currencies'); }
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('اختر عميلاً');
      const num = Number(amount);
      if (!Number.isFinite(num) || num <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
      const parsedDueDate = parseFlexibleDate(dueDate);
      if (!parsedDueDate) throw new Error('أدخل تاريخًا صحيحًا، مثلاً 128 أو 1282026');
      const payload: any = {
        customerId,
        expectedAmount: num,
        currencyCode: currency,
        dueDate: parsedDueDate.iso,
        notes: notes || undefined,
      };
      let position: Awaited<ReturnType<typeof getCurrentPosition>> | null = null;
      try {
        position = await getCurrentPosition();
      } catch { /* GPS optional */ }
      try {
        const result = await createPromise(payload);
        if (position && result.data?.id) {
          await saveGpsPoint({ ...position, entityTable: 'payment_promises', entityId: result.data.id });
        }
        return result;
      } catch (err: any) {
        if (!err?.response) {
          const opId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          await enqueueMutation(opId, 'POST', '/payment-promises', payload);
          if (position) await saveGpsPoint({ ...position, entityTable: 'payment_promises', entityId: `local:${opId}` });
          return { data: { id: opId, offline: true } };
        }
        throw err;
      }
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['customer-details'] });
      queryClient.invalidateQueries({ queryKey: ['customer-timeline'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['payment-promises'] });
      queryClient.invalidateQueries({ queryKey: ['sync'] });
      triggerSync();
      Alert.alert('تم', res?.data?.offline ? 'تم حفظ الوعد محليًا وسيُزامَن لاحقًا' : 'تم تسجيل وعد السداد');
      navigation.goBack();
    },
    onError: (err: any) => {
      Alert.alert('خطأ', apiErrorMessage(err, 'فشل تسجيل وعد السداد'));
    },
  });

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <CustomerPicker
        selectedId={customerId}
        selectedName={customerName}
        onSelect={(c) => { setCustomerId(c.id); setCustomerName(c.fullName); }}
      />

      <Text style={styles.label}>المبلغ</Text>
      <TextInput
        style={styles.input}
        placeholder="المبلغ المتوقع"
        placeholderTextColor="#999"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
      />

      <Text style={styles.label}>العملة</Text>
      <View style={styles.currencyRow}>
        {(currencies ?? []).map((c) => (
          <TouchableOpacity key={c.code} style={[styles.currencyBtn, currency === c.code && styles.currencyBtnActive]}
            onPress={() => setCurrency(c.code)}>
            <Text style={[styles.currencyText, currency === c.code && styles.currencyTextActive]}>{c.code}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>تاريخ الاستحقاق</Text>
      <TextInput
        style={styles.input}
        placeholder="مثال: 128 أو 1282026"
        placeholderTextColor="#999"
        value={dueDate}
        onChangeText={setDueDate}
        onBlur={() => {
          const parsed = parseFlexibleDate(dueDate);
          if (parsed) setDueDate(parsed.display);
        }}
        keyboardType="number-pad"
        maxLength={10}
      />

      <Text style={styles.label}>ملاحظات</Text>
      <TextInput style={styles.textarea} placeholder="ملاحظات..." placeholderTextColor="#999" value={notes} onChangeText={setNotes} multiline />

      <TouchableOpacity style={styles.button} onPress={() => mutation.mutate()} disabled={!customerId || !amount || !dueDate || mutation.isPending}>
        <Text style={styles.buttonText}>{mutation.isPending ? 'جارٍ الحفظ...' : 'تسجيل'}</Text>
      </TouchableOpacity>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 15, fontWeight: '800', color: colors.ink, marginBottom: 8, marginTop: 16, textAlign: 'right' },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, fontSize: 16, color: colors.ink, marginBottom: 8, borderWidth: 1, borderColor: colors.line, textAlign: 'right' },
  currencyRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  currencyBtn: { flex: 1, minWidth: 70, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', borderWidth: 1, borderColor: colors.line },
  currencyBtnActive: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  currencyText: { color: colors.ink, fontWeight: '700' },
  currencyTextActive: { color: colors.primary, fontWeight: '900' },
  textarea: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, fontSize: 16, color: colors.ink, textAlignVertical: 'top', textAlign: 'right', minHeight: 80, borderWidth: 1, borderColor: colors.line },
  button: { backgroundColor: colors.gold, borderRadius: radius.md, padding: 16, alignItems: 'center', marginTop: 24, ...shadow },
  buttonText: { color: colors.primary, fontSize: 17, fontWeight: '900' },
});
