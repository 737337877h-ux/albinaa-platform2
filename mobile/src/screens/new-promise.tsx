import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createPromise, fetchCurrencies } from '../api/endpoints';
import { enqueueMutation } from '../db/database';
import { getCurrentPosition } from '../utils/gps';
import { apiErrorMessage } from '../utils/errors';
import { useSync } from '../store/sync-context';
import CustomerPicker from '../components/customer-picker';

export default function NewPromiseScreen({ route, navigation }: any) {
  const presetCustomerId = route.params?.customerId || '';
  const presetCustomerName = route.params?.customerName || '';
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('YER');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [notes, setNotes] = useState('');
  const [customerId, setCustomerId] = useState(presetCustomerId);
  const [customerName, setCustomerName] = useState(presetCustomerName);
  const queryClient = useQueryClient();
  const { triggerSync } = useSync();
  const { data: currencies } = useQuery({
    queryKey: ['currencies'],
    queryFn: () => fetchCurrencies().then((r) => r.data),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('اختر عميلاً');
      const num = Number(amount);
      if (!Number.isFinite(num) || num <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
      if (!dueDate) throw new Error('تاريخ الاستحقاق مطلوب');
      const payload: any = {
        customerId,
        expectedAmount: num,
        currencyCode: currency,
        dueDate: new Date(dueDate).toISOString(),
        notes: notes || undefined,
      };
      try {
        const pos = await getCurrentPosition();
        Object.assign(payload, { gpsLatitude: pos.latitude, gpsLongitude: pos.longitude, gpsAccuracy: pos.accuracy });
      } catch { /* GPS optional */ }
      try {
        return await createPromise(payload);
      } catch (err: any) {
        if (!err?.response) {
          const opId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          await enqueueMutation(opId, 'POST', '/payment-promises', payload);
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
    <ScrollView style={styles.container}>
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
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#999"
        value={dueDate}
        onChangeText={setDueDate}
      />

      <Text style={styles.label}>ملاحظات</Text>
      <TextInput style={styles.textarea} placeholder="ملاحظات..." placeholderTextColor="#999" value={notes} onChangeText={setNotes} multiline />

      <TouchableOpacity style={styles.button} onPress={() => mutation.mutate()} disabled={!customerId || !amount || !dueDate || mutation.isPending}>
        <Text style={styles.buttonText}>{mutation.isPending ? 'جارٍ الحفظ...' : 'تسجيل'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8', padding: 16 },
  label: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 14, fontSize: 16, color: '#333', marginBottom: 8 },
  currencyRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  currencyBtn: { flex: 1, minWidth: 70, padding: 12, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', borderWidth: 1, borderColor: '#ddd' },
  currencyBtnActive: { backgroundColor: '#34a853', borderColor: '#34a853' },
  currencyText: { color: '#333' },
  currencyTextActive: { color: '#fff' },
  textarea: { backgroundColor: '#fff', borderRadius: 10, padding: 14, fontSize: 16, color: '#333', textAlignVertical: 'top', minHeight: 80 },
  button: { backgroundColor: '#34a853', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24, marginBottom: 40 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
