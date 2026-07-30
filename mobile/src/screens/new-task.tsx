import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTask } from '../api/endpoints';
import { enqueueMutation } from '../db/database';
import { apiErrorMessage } from '../utils/errors';
import { useSync } from '../store/sync-context';
import CustomerPicker from '../components/customer-picker';

const TASK_TYPES = ['visit', 'call', 'promise_due', 'followup', 'collection', 'other'];

export default function NewTaskScreen({ route, navigation }: any) {
  const presetCustomerId = route.params?.customerId || '';
  const presetCustomerName = route.params?.customerName || '';
  const [customerId, setCustomerId] = useState(presetCustomerId);
  const [customerName, setCustomerName] = useState(presetCustomerName);
  const [taskType, setTaskType] = useState('visit');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [priorityReason, setPriorityReason] = useState('');
  const [expectedAmount, setExpectedAmount] = useState('');
  const [expectedCurrency, setExpectedCurrency] = useState('YER');
  const queryClient = useQueryClient();
  const { triggerSync } = useSync();

  const mutation = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('اختر عميلاً');
      if (!taskType) throw new Error('اختر نوع المهمة');
      if (!dueDate) throw new Error('تاريخ الاستحقاق مطلوب');
      const payload: any = {
        customerId,
        taskType,
        dueDate: new Date(dueDate).toISOString(),
        priorityReason: priorityReason || undefined,
        expectedAmount: expectedAmount ? Number(expectedAmount) : undefined,
        expectedCurrency: expectedAmount ? expectedCurrency : undefined,
      };
      try {
        return await createTask(payload);
      } catch (err: any) {
        if (!err?.response) {
          const opId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          await enqueueMutation(opId, 'POST', '/tasks', payload);
          return { data: { id: opId, offline: true } };
        }
        throw err;
      }
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['customer-details'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['sync'] });
      triggerSync();
      Alert.alert('تم', res?.data?.offline ? 'تم حفظ المهمة محليًا وسيُزامَن لاحقًا' : 'تم تسجيل المهمة');
      navigation.goBack();
    },
    onError: (err: any) => {
      Alert.alert('خطأ', apiErrorMessage(err, 'فشل تسجيل المهمة'));
    },
  });

  return (
    <ScrollView style={styles.container}>
      <CustomerPicker
        selectedId={customerId}
        selectedName={customerName}
        onSelect={(c) => { setCustomerId(c.id); setCustomerName(c.fullName); }}
      />

      <Text style={styles.label}>نوع المهمة</Text>
      <View style={styles.typeRow}>
        {TASK_TYPES.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.typeBtn, taskType === t && styles.typeBtnActive]}
            onPress={() => setTaskType(t)}
          >
            <Text style={[styles.typeText, taskType === t && styles.typeTextActive]}>{t}</Text>
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

      <Text style={styles.label}>سبب الأولوية (اختياري)</Text>
      <TextInput
        style={styles.input}
        placeholder="مثلاً: رصيد مرتفع، وعد سابق..."
        placeholderTextColor="#999"
        value={priorityReason}
        onChangeText={setPriorityReason}
      />

      <Text style={styles.label}>المبلغ المتوقع (اختياري)</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 2, marginRight: 8 }]}
          placeholder="المبلغ"
          placeholderTextColor="#999"
          value={expectedAmount}
          onChangeText={setExpectedAmount}
          keyboardType="numeric"
        />
        <View style={[styles.typeRow, { flex: 1 }]}>
          {['YER', 'SAR', 'USD'].map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.typeBtn, expectedCurrency === c && styles.typeBtnActive, { minWidth: 0, flex: 1 }]}
              onPress={() => setExpectedCurrency(c)}
            >
              <Text style={[styles.typeText, expectedCurrency === c && styles.typeTextActive]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity
        style={styles.button}
        onPress={() => mutation.mutate()}
        disabled={!customerId || !taskType || !dueDate || mutation.isPending}
      >
        <Text style={styles.buttonText}>{mutation.isPending ? 'جارٍ الحفظ...' : 'تسجيل المهمة'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8', padding: 16 },
  label: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 14, fontSize: 16, color: '#333', marginBottom: 8 },
  typeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  typeBtn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', borderWidth: 1, borderColor: '#ddd', minWidth: '30%' },
  typeBtnActive: { backgroundColor: '#1a73e8', borderColor: '#1a73e8' },
  typeText: { color: '#333', textAlign: 'center' },
  typeTextActive: { color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center' },
  button: { backgroundColor: '#1a73e8', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24, marginBottom: 40 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
