import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFollowup, fetchFollowupResults, fetchFollowupTypes } from '../api/endpoints';
import { enqueueMutation, getReferenceOptions } from '../db/database';
import { apiErrorMessage } from '../utils/errors';
import { useSync } from '../store/sync-context';
import CustomerPicker from '../components/customer-picker';
import { colors, radius, shadow } from '../theme';
import { parseFlexibleDate } from '../utils/date-input';

function isPaidFollowupResult(result: any): boolean {
  const value = `${result?.name || ''} ${result?.code || ''}`
    .trim()
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/\s+/g, ' ');
  return value.includes('تم السداد')
    || value.includes('سدد بالكامل')
    || /(^|\s)(paid|fully_paid|payment_completed)(\s|$)/.test(value);
}

export default function NewFollowupScreen({ route, navigation }: any) {
  const presetCustomerId = route.params?.customerId || '';
  const presetCustomerName = route.params?.customerName || '';
  const [customerId, setCustomerId] = useState(presetCustomerId);
  const [customerName, setCustomerName] = useState(presetCustomerName);
  const [typeId, setTypeId] = useState('');
  const [resultId, setResultId] = useState('');
  const [notes, setNotes] = useState('');
  const [nextFollowupDate, setNextFollowupDate] = useState('');
  const queryClient = useQueryClient();
  const { triggerSync } = useSync();

  const typesQuery = useQuery({
    queryKey: ['followup-types'],
    queryFn: async () => {
      try { return (await fetchFollowupTypes()).data || []; }
      catch { return getReferenceOptions('followupTypes'); }
    },
  });
  const resultsQuery = useQuery({
    queryKey: ['followup-results'],
    queryFn: async () => {
      try { return (await fetchFollowupResults()).data || []; }
      catch { return getReferenceOptions('followupResults'); }
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('اختر عميلاً');
      if (!typeId) throw new Error('اختر نوع المتابعة');
      if (!resultId) throw new Error('اختر نتيجة المتابعة');
      const selectedResult = (resultsQuery.data || []).find((item: any) => item.id === resultId);
      const requiresNextFollowup = !isPaidFollowupResult(selectedResult);
      const parsedNextDate = requiresNextFollowup ? parseFlexibleDate(nextFollowupDate) : null;
      if (requiresNextFollowup && !parsedNextDate) {
        throw new Error('حدد موعد المتابعة القادمة، مثلاً 128 أو 1282026');
      }
      const payload = {
        customerId,
        typeId,
        resultId,
        notes: notes || undefined,
        followupAt: new Date().toISOString(),
        nextFollowupDate: parsedNextDate?.iso,
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
  const selectedResult = results.find((item: any) => item.id === resultId);
  const requiresNextFollowup = Boolean(resultId && !isPaidFollowupResult(selectedResult));

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <CustomerPicker
        selectedId={customerId}
        selectedName={customerName}
        onSelect={(c) => { setCustomerId(c.id); setCustomerName(c.fullName); }}
      />

      <Text style={styles.label}>نوع المتابعة</Text>
      {typesQuery.isLoading ? (
        <ActivityIndicator color={colors.goldDark} />
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
        <ActivityIndicator color={colors.goldDark} />
      ) : (
        <View style={styles.typeRow}>
          {results.map((r: any) => (
            <TouchableOpacity
              key={r.id}
              style={[styles.typeBtn, resultId === r.id && styles.typeBtnActive]}
              onPress={() => {
                setResultId(r.id);
                if (isPaidFollowupResult(r)) setNextFollowupDate('');
              }}
            >
              <Text style={[styles.typeText, resultId === r.id && styles.typeTextActive]}>{r.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {requiresNextFollowup ? (
        <>
          <Text style={styles.label}>موعد المتابعة القادمة</Text>
          <TextInput
            style={styles.input}
            placeholder="مثال: 128 أو 1282026"
            placeholderTextColor="#999"
            value={nextFollowupDate}
            onChangeText={setNextFollowupDate}
            onBlur={() => {
              const parsed = parseFlexibleDate(nextFollowupDate);
              if (parsed) setNextFollowupDate(parsed.display);
            }}
            keyboardType="number-pad"
            maxLength={10}
          />
          <Text style={styles.hint}>يُطلب الموعد لكل نتيجة عدا «تم السداد».</Text>
        </>
      ) : null}

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
        disabled={!customerId || !typeId || !resultId || (requiresNextFollowup && !nextFollowupDate) || mutation.isPending}
      >
        <Text style={styles.buttonText}>{mutation.isPending ? 'جارٍ الحفظ...' : 'حفظ'}</Text>
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
  typeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  typeBtn: { paddingVertical: 12, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', borderWidth: 1, borderColor: colors.line, minWidth: '30%' },
  typeBtnActive: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  typeText: { color: colors.ink, textAlign: 'center', fontWeight: '700' },
  typeTextActive: { color: colors.primary, fontWeight: '900' },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, fontSize: 16, color: colors.ink, borderWidth: 1, borderColor: colors.line, textAlign: 'right' },
  hint: { marginTop: 6, color: colors.muted, fontSize: 12, textAlign: 'right' },
  textarea: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, fontSize: 16, color: colors.ink, textAlignVertical: 'top', textAlign: 'right', minHeight: 100, borderWidth: 1, borderColor: colors.line },
  button: { backgroundColor: colors.gold, borderRadius: radius.md, padding: 16, alignItems: 'center', marginTop: 24, ...shadow },
  buttonText: { color: colors.primary, fontSize: 17, fontWeight: '900' },
});
