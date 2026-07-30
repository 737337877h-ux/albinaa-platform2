import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFollowup, fetchFollowupResults, fetchFollowupTypes } from '../api/endpoints';
import { enqueueMutation } from '../db/database';
import { apiErrorMessage } from '../utils/errors';
import { useSync } from '../store/sync-context';
import CustomerPicker from '../components/customer-picker';

export default function NewFollowupScreen({ route, navigation }: any) {
  const presetCustomerId = route.params?.customerId || '';
  const presetCustomerName = route.params?.customerName || '';
  const [customerId, setCustomerId] = useState(presetCustomerId);
  const [customerName, setCustomerName] = useState(presetCustomerName);
  const [typeId, setTypeId] = useState('');
  const [resultId, setResultId] = useState('');
  const [notes, setNotes] = useState('');
  const queryClient = useQueryClient();
  const { triggerSync } = useSync();

  const typesQuery = useQuery({
    queryKey: ['followup-types'],
    queryFn: () => fetchFollowupTypes().then((r) => r.data || []),
  });
  const resultsQuery = useQuery({
    queryKey: ['followup-results'],
    queryFn: () => fetchFollowupResults().then((r) => r.data || []),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('اختر عميلاً');
      if (!typeId) throw new Error('اختر نوع المتابعة');
      if (!resultId) throw new Error('اختر نتيجة المتابعة');
      const payload = {
        customerId,
        typeId,
        resultId,
        notes: notes || undefined,
        followupAt: new Date().toISOString(),
      };
      try {
        return await createFollowup(payload);
      } catch (err: any) {
        if (!err?.response) {
          const opId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          await enqueueMutation(opId, 'POST', '/followups', payload);
          return { data: { id: opId, offline: true } };
        }
        throw err;
      }
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['customer-details'] });
      queryClient.invalidateQueries({ queryKey: ['customer-timeline'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['followups'] });
      queryClient.invalidateQueries({ queryKey: ['sync'] });
      triggerSync();
      Alert.alert('تم', res?.data?.offline ? 'تم حفظ المتابعة محليًا وسيُزامَن لاحقًا' : 'تم تسجيل المتابعة');
      navigation.goBack();
    },
    onError: (err: any) => {
      Alert.alert('خطأ', apiErrorMessage(err, 'فشل تسجيل المتابعة'));
    },
  });

  const types = typesQuery.data || [];
  const results = resultsQuery.data || [];

  return (
    <ScrollView style={styles.container}>
      <CustomerPicker
        selectedId={customerId}
        selectedName={customerName}
        onSelect={(c) => { setCustomerId(c.id); setCustomerName(c.fullName); }}
      />

      <Text style={styles.label}>نوع المتابعة</Text>
      {typesQuery.isLoading ? (
        <ActivityIndicator color="#1a73e8" />
      ) : (
        <View style={styles.typeRow}>
          {types.map((t: any) => (
            <TouchableOpacity
              key={t.id}
              style={[styles.typeBtn, typeId === t.id && styles.typeBtnActive]}
              onPress={() => setTypeId(t.id)}
            >
              <Text style={[styles.typeText, typeId === t.id && styles.typeTextActive]}>{t.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={styles.label}>نتيجة المتابعة</Text>
      {resultsQuery.isLoading ? (
        <ActivityIndicator color="#1a73e8" />
      ) : (
        <View style={styles.typeRow}>
          {results.map((r: any) => (
            <TouchableOpacity
              key={r.id}
              style={[styles.typeBtn, resultId === r.id && styles.typeBtnActive]}
              onPress={() => setResultId(r.id)}
            >
              <Text style={[styles.typeText, resultId === r.id && styles.typeTextActive]}>{r.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={styles.label}>ملاحظات</Text>
      <TextInput
        style={styles.textarea}
        placeholder="أضف ملاحظات..."
        placeholderTextColor="#999"
        value={notes}
        onChangeText={setNotes}
        multiline
        numberOfLines={4}
      />

      <TouchableOpacity
        style={styles.button}
        onPress={() => mutation.mutate()}
        disabled={!customerId || !typeId || !resultId || mutation.isPending}
      >
        <Text style={styles.buttonText}>{mutation.isPending ? 'جارٍ الحفظ...' : 'حفظ'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8', padding: 16 },
  label: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8, marginTop: 16 },
  typeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  typeBtn: { paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', borderWidth: 1, borderColor: '#ddd', minWidth: '30%' },
  typeBtnActive: { backgroundColor: '#1a73e8', borderColor: '#1a73e8' },
  typeText: { color: '#333', textAlign: 'center' },
  typeTextActive: { color: '#fff' },
  textarea: { backgroundColor: '#fff', borderRadius: 10, padding: 14, fontSize: 16, color: '#333', textAlignVertical: 'top', minHeight: 100 },
  button: { backgroundColor: '#1a73e8', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24, marginBottom: 40 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
