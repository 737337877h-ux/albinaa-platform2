import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createTask, fetchCurrencies } from '../api/endpoints';
import { enqueueMutation, getReferenceOptions } from '../db/database';
import { apiErrorMessage } from '../utils/errors';
import { useSync } from '../store/sync-context';
import CustomerPicker from '../components/customer-picker';
import { colors, radius, shadow } from '../theme';
import { displayDateFromIso, parseFlexibleDate } from '../utils/date-input';

const TASK_TYPES = ['visit', 'call', 'promise_due', 'followup', 'collection', 'other'];
const TASK_TYPE_LABELS: Record<string, string> = {
  visit: 'زيارة',
  call: 'اتصال',
  promise_due: 'استحقاق وعد',
  followup: 'متابعة',
  collection: 'تحصيل',
  other: 'أخرى',
};

export default function NewTaskScreen({ route, navigation }: any) {
  const presetCustomerId = route.params?.customerId || '';
  const presetCustomerName = route.params?.customerName || '';
  const [customerId, setCustomerId] = useState(presetCustomerId);
  const [customerName, setCustomerName] = useState(presetCustomerName);
  const [taskType, setTaskType] = useState('visit');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return displayDateFromIso(d.toISOString().split('T')[0]);
  });
  const [priorityReason, setPriorityReason] = useState('');
  const [expectedAmount, setExpectedAmount] = useState('');
  const [expectedCurrency, setExpectedCurrency] = useState('YER');
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
      if (!taskType) throw new Error('اختر نوع المهمة');
      const parsedDueDate = parseFlexibleDate(dueDate);
      if (!parsedDueDate) throw new Error('أدخل تاريخًا صحيحًا، مثلاً 128 أو 1282026');
      const payload: any = {
        customerId,
        taskType,
        dueDate: parsedDueDate.iso,
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
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
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
            <Text style={[styles.typeText, taskType === t && styles.typeTextActive]}>{TASK_TYPE_LABELS[t]}</Text>
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
          {(currencies ?? []).map((c) => (
            <TouchableOpacity
              key={c.code}
              style={[styles.typeBtn, expectedCurrency === c.code && styles.typeBtnActive, { minWidth: 0, flex: 1 }]}
              onPress={() => setExpectedCurrency(c.code)}
            >
              <Text style={[styles.typeText, expectedCurrency === c.code && styles.typeTextActive]}>{c.code}</Text>
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 15, fontWeight: '800', color: colors.ink, marginBottom: 8, marginTop: 18, textAlign: 'right' },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, fontSize: 16, color: colors.ink, marginBottom: 8, borderWidth: 1, borderColor: colors.line, textAlign: 'right' },
  typeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  typeBtn: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', borderWidth: 1, borderColor: colors.line, minWidth: '30%', ...shadow },
  typeBtnActive: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  typeText: { color: colors.ink, textAlign: 'center', fontWeight: '700' },
  typeTextActive: { color: colors.primary, fontWeight: '900' },
  row: { flexDirection: 'row', alignItems: 'center' },
  button: { backgroundColor: colors.gold, borderRadius: radius.md, padding: 16, alignItems: 'center', marginTop: 26, ...shadow },
  buttonText: { color: colors.primary, fontSize: 17, fontWeight: '900' },
});
