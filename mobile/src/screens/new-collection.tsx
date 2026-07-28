import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { createCollection } from '../api/endpoints';
import { enqueueMutation } from '../db/database';
import { getCurrentPosition } from '../utils/gps';

const PAYMENT_METHODS = [
  { id: 'cash', name: 'نقداً' },
  { id: 'bank_transfer', name: 'تحويل بنكي' },
  { id: 'check', name: 'شيك' },
  { id: 'pos', name: 'نقطة بيع' },
];

export default function NewCollectionScreen({ route, navigation }: any) {
  const customerId = route.params?.customerId || '';
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('SAR');
  const [methodId, setMethodId] = useState('');
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        customerId,
        amount: Number(amount),
        currencyCode: currency,
        methodId,
        notes,
        collectedAt: new Date().toISOString(),
      };
      try {
        const pos = await getCurrentPosition();
        Object.assign(payload, { gpsLatitude: pos.latitude, gpsLongitude: pos.longitude, gpsAccuracy: pos.accuracy });
      } catch { /* GPS optional */ }
      if (customerId) {
        return createCollection(payload);
      }
      const opId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await enqueueMutation(opId, 'POST', '/collections', payload);
      return { data: { id: opId } };
    },
    onSuccess: () => {
      Alert.alert('تم', 'تم تسجيل التحصيل', [
        { text: 'رفع سند', onPress: () => navigation.replace('UploadReceipt', { collectionId: '' }) },
        { text: 'رجوع', onPress: () => navigation.goBack() },
      ]);
    },
    onError: (err: any) => {
      Alert.alert('خطأ', err.response?.data?.message || 'فشل تسجيل التحصيل');
    },
  });

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.label}>المبلغ المحصل</Text>
      <TextInput style={styles.input} placeholder="المبلغ" placeholderTextColor="#999" value={amount} onChangeText={setAmount} keyboardType="numeric" />

      <Text style={styles.label}>العملة</Text>
      <View style={styles.row}>
        {['SAR', 'USD', 'AED'].map((c) => (
          <TouchableOpacity key={c} style={[styles.btn, currency === c && styles.btnActiveGreen]} onPress={() => setCurrency(c)}>
            <Text style={[styles.btnText, currency === c && styles.btnTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>طريقة الدفع</Text>
      <View style={styles.row}>
        {PAYMENT_METHODS.map((m) => (
          <TouchableOpacity key={m.id} style={[styles.btn, methodId === m.id && styles.btnActiveGreen]} onPress={() => setMethodId(m.id)}>
            <Text style={[styles.btnText, methodId === m.id && styles.btnTextActive]}>{m.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>ملاحظات</Text>
      <TextInput style={styles.textarea} placeholder="ملاحظات..." placeholderTextColor="#999" value={notes} onChangeText={setNotes} multiline />

      <TouchableOpacity style={styles.button} onPress={() => mutation.mutate()} disabled={!amount || !methodId || mutation.isPending}>
        <Text style={styles.buttonText}>{mutation.isPending ? 'جارٍ الحفظ...' : 'تسجيل التحصيل'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8', padding: 16 },
  label: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 14, fontSize: 16, color: '#333', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btn: { padding: 12, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', borderWidth: 1, borderColor: '#ddd', minWidth: 60 },
  btnActiveGreen: { backgroundColor: '#ea4335', borderColor: '#ea4335' },
  btnText: { color: '#333' },
  btnTextActive: { color: '#fff' },
  textarea: { backgroundColor: '#fff', borderRadius: 10, padding: 14, fontSize: 16, color: '#333', textAlignVertical: 'top', minHeight: 80 },
  button: { backgroundColor: '#ea4335', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
