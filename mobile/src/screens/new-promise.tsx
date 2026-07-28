import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { createPromise } from '../api/endpoints';
import { enqueueMutation } from '../db/database';
import { getCurrentPosition } from '../utils/gps';

export default function NewPromiseScreen({ route, navigation }: any) {
  const customerId = route.params?.customerId || '';
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('SAR');
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        customerId,
        expectedAmount: Number(amount),
        currencyCode: currency,
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        notes,
      };
      try {
        const pos = await getCurrentPosition();
        Object.assign(payload, { gpsLatitude: pos.latitude, gpsLongitude: pos.longitude, gpsAccuracy: pos.accuracy });
      } catch { /* GPS optional */ }
      if (customerId) {
        return createPromise(payload);
      }
      const opId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await enqueueMutation(opId, 'POST', '/promises', payload);
      return { data: { id: opId } };
    },
    onSuccess: () => {
      Alert.alert('تم', 'تم تسجيل وعد السداد');
      navigation.goBack();
    },
    onError: (err: any) => {
      Alert.alert('خطأ', err.response?.data?.message || 'فشل تسجيل وعد السداد');
    },
  });

  return (
    <ScrollView style={styles.container}>
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
        {['SAR', 'USD', 'AED'].map((c) => (
          <TouchableOpacity key={c} style={[styles.currencyBtn, currency === c && styles.currencyBtnActive]}
            onPress={() => setCurrency(c)}>
            <Text style={[styles.currencyText, currency === c && styles.currencyTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>ملاحظات</Text>
      <TextInput style={styles.textarea} placeholder="ملاحظات..." placeholderTextColor="#999" value={notes} onChangeText={setNotes} multiline />

      <TouchableOpacity style={styles.button} onPress={() => mutation.mutate()} disabled={!amount || mutation.isPending}>
        <Text style={styles.buttonText}>{mutation.isPending ? 'جارٍ الحفظ...' : 'تسجيل'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8', padding: 16 },
  label: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 14, fontSize: 16, color: '#333', marginBottom: 8 },
  currencyRow: { flexDirection: 'row', gap: 8 },
  currencyBtn: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', borderWidth: 1, borderColor: '#ddd' },
  currencyBtnActive: { backgroundColor: '#34a853', borderColor: '#34a853' },
  currencyText: { color: '#333' },
  currencyTextActive: { color: '#fff' },
  textarea: { backgroundColor: '#fff', borderRadius: 10, padding: 14, fontSize: 16, color: '#333', textAlignVertical: 'top', minHeight: 80 },
  button: { backgroundColor: '#34a853', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
