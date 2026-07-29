import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, Platform } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { createPromise } from '../api/endpoints';
import { enqueueMutation } from '../db/database';
import { getCurrentPosition } from '../utils/gps';
import { apiErrorMessage } from '../utils/errors';

const CURRENCIES = ['YER', 'SAR', 'USD'];

export default function NewPromiseScreen({ route, navigation }: any) {
  const customerId = route.params?.customerId || '';
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('YER');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!customerId) {
      Alert.alert('تنبيه', 'اختر عميلاً أولاً من قائمة العملاء ثم اضغط وعد سداد', [
        { text: 'حسناً', onPress: () => navigation.goBack() },
      ]);
    }
  }, [customerId]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('معرّف العميل مطلوب');
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
      Alert.alert('تم', res?.data?.offline ? 'تم حفظ الوعد محليًا وسيُزامَن لاحقًا' : 'تم تسجيل وعد السداد');
      navigation.goBack();
    },
    onError: (err: any) => {
      Alert.alert('خطأ', apiErrorMessage(err, 'فشل تسجيل وعد السداد'));
    },
  });

  return (
    <ScrollView style={styles.container}>
      {!customerId && <Text style={styles.warn}>يجب اختيار عميل قبل تسجيل وعد السداد</Text>}

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
        {CURRENCIES.map((c) => (
          <TouchableOpacity key={c} style={[styles.currencyBtn, currency === c && styles.currencyBtnActive]}
            onPress={() => setCurrency(c)}>
            <Text style={[styles.currencyText, currency === c && styles.currencyTextActive]}>{c}</Text>
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
  button: { backgroundColor: '#34a853', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  warn: { color: '#b45309', backgroundColor: '#fff7ed', padding: 12, borderRadius: 8, marginBottom: 8 },
});
