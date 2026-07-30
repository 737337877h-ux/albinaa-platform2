import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createCollection, fetchCollectionMethods, fetchCurrencies } from '../api/endpoints';
import { enqueueMutation } from '../db/database';
import { getCurrentPosition } from '../utils/gps';
import { apiErrorMessage } from '../utils/errors';
import { useSync } from '../store/sync-context';
import CustomerPicker from '../components/customer-picker';

export default function NewCollectionScreen({ route, navigation }: any) {
  const presetCustomerId = route.params?.customerId || '';
  const presetCustomerName = route.params?.customerName || '';
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('YER');
  const [methodId, setMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [customerId, setCustomerId] = useState(presetCustomerId);
  const [customerName, setCustomerName] = useState(presetCustomerName);
  const queryClient = useQueryClient();
  const { triggerSync } = useSync();

  const methodsQuery = useQuery({
    queryKey: ['collection-methods'],
    queryFn: () => fetchCollectionMethods().then((r) => r.data || []),
  });

  const currenciesQuery = useQuery({
    queryKey: ['currencies'],
    queryFn: () => fetchCurrencies().then((r) => r.data || []),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('اختر عميلاً');
      if (!methodId) throw new Error('اختر طريقة الدفع');
      const num = Number(amount);
      if (!Number.isFinite(num) || num <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');

      const payload: any = {
        customerId,
        amount: num,
        currencyCode: currency,
        methodId,
        notes: notes || undefined,
        collectedAt: new Date().toISOString(),
      };
      try {
        const pos = await getCurrentPosition();
        Object.assign(payload, { gpsLatitude: pos.latitude, gpsLongitude: pos.longitude, gpsAccuracy: pos.accuracy });
      } catch { /* GPS optional */ }

      try {
        return await createCollection(payload);
      } catch (err: any) {
        if (!err?.response) {
          const opId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          await enqueueMutation(opId, 'POST', '/collections', payload);
          return { data: { id: opId, offline: true } };
        }
        throw err;
      }
    },
    onSuccess: (res: any) => {
      const collectionId = res?.data?.id || res?.id || '';
      queryClient.invalidateQueries({ queryKey: ['customer-details'] });
      queryClient.invalidateQueries({ queryKey: ['customer-timeline'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      queryClient.invalidateQueries({ queryKey: ['sync'] });
      triggerSync();
      Alert.alert('تم', res?.data?.offline ? 'تم حفظ التحصيل محليًا وسيُزامَن لاحقًا' : 'تم تسجيل التحصيل', [
        ...(collectionId && !res?.data?.offline
          ? [{ text: 'رفع سند', onPress: () => navigation.replace('UploadReceipt', { collectionId }) }]
          : []),
        { text: 'رجوع', onPress: () => navigation.goBack() },
      ]);
    },
    onError: (err: any) => {
      Alert.alert('خطأ', apiErrorMessage(err, 'فشل تسجيل التحصيل'));
    },
  });

  const methods = methodsQuery.data || [];

  return (
    <ScrollView style={styles.container}>
      <CustomerPicker
        selectedId={customerId}
        selectedName={customerName}
        onSelect={(c) => { setCustomerId(c.id); setCustomerName(c.fullName); }}
      />

      <Text style={styles.label}>المبلغ المحصل</Text>
      <TextInput style={styles.input} placeholder="المبلغ" placeholderTextColor="#999" value={amount} onChangeText={setAmount} keyboardType="numeric" />

      <Text style={styles.label}>العملة</Text>
      <View style={styles.row}>
        {(currenciesQuery.data ?? []).map((c) => (
          <TouchableOpacity key={c.code} style={[styles.btn, currency === c.code && styles.btnActiveGreen]} onPress={() => setCurrency(c.code)}>
            <Text style={[styles.btnText, currency === c.code && styles.btnTextActive]}>{c.code}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>طريقة الدفع</Text>
      {methodsQuery.isLoading ? (
        <ActivityIndicator color="#1a73e8" />
      ) : methods.length === 0 ? (
        <Text style={styles.warn}>تعذر تحميل طرق الدفع من الخادم</Text>
      ) : (
        <View style={styles.row}>
          {methods.map((m: any) => (
            <TouchableOpacity key={m.id} style={[styles.btn, methodId === m.id && styles.btnActiveGreen]} onPress={() => setMethodId(m.id)}>
              <Text style={[styles.btnText, methodId === m.id && styles.btnTextActive]}>{m.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={styles.label}>ملاحظات</Text>
      <TextInput style={styles.textarea} placeholder="ملاحظات..." placeholderTextColor="#999" value={notes} onChangeText={setNotes} multiline />

      <TouchableOpacity
        style={styles.button}
        onPress={() => mutation.mutate()}
        disabled={!customerId || !amount || !methodId || mutation.isPending}
      >
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
  button: { backgroundColor: '#ea4335', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24, marginBottom: 40 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  warn: { color: '#b45309', backgroundColor: '#fff7ed', padding: 12, borderRadius: 8, marginBottom: 8 },
});
