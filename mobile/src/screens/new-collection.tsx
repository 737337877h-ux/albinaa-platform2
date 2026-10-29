import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createCollection, fetchCollectionMethods, fetchCurrencies } from '../api/endpoints';
import { enqueueMutation, getReferenceOptions, recordCollectionOffline, saveGpsPoint } from '../db/database';
import { getCurrentPosition } from '../utils/gps';
import { apiErrorMessage } from '../utils/errors';
import CustomerPicker from '../components/customer-picker';
import { colors, radius, shadow } from '../theme';

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

  const methodsQuery = useQuery({
    queryKey: ['collection-methods'],
    queryFn: async () => {
      try { return (await fetchCollectionMethods()).data || []; }
      catch { return getReferenceOptions('collectionMethods'); }
    },
  });

  const currenciesQuery = useQuery({
    queryKey: ['currencies'],
    queryFn: async () => {
      try { return (await fetchCurrencies()).data || []; }
      catch { return getReferenceOptions('currencies'); }
    },
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
      const positionPromise = Promise.race([
        getCurrentPosition().catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_200)),
      ]);

      try {
        const result = await createCollection(payload);
        if (result.data?.id) {
          positionPromise.then((position) => {
            if (position) return saveGpsPoint({ ...position, entityTable: 'collections', entityId: result.data.id });
          }).catch(() => undefined);
        }
        return result;
      } catch (err: any) {
        if (!err?.response) {
          const opId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          await enqueueMutation(opId, 'POST', '/collections', payload);
          positionPromise.then((position) => {
            if (position) return saveGpsPoint({ ...position, entityTable: 'collections', entityId: `local:${opId}` });
          }).catch(() => undefined);
          return { data: { id: opId, offline: true } };
        }
        throw err;
      }
    },
    onSuccess: async (res: any) => {
      const collectionId = res?.data?.id || res?.id || '';
      if (collectionId && !res?.data?.offline) {
        await recordCollectionOffline({
          id: collectionId,
          customerId,
          customerName,
          amount: Number(amount),
          currencyCode: currency,
          methodName: (methodsQuery.data || []).find((item: any) => item.id === methodId)?.name,
          notes: notes || undefined,
          collectedAt: res?.data?.collectedAt || new Date().toISOString(),
        });
      }
      queryClient.invalidateQueries({ queryKey: ['customer-details'] });
      queryClient.invalidateQueries({ queryKey: ['customer-timeline'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      queryClient.invalidateQueries({ queryKey: ['sync'] });
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
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
        <ActivityIndicator color={colors.goldDark} />
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 48 },
  label: { fontFamily: 'TajawalBold', fontSize: 16, fontWeight: '800', color: colors.ink, marginBottom: 8, marginTop: 18, textAlign: 'right' },
  input: { fontFamily: 'TajawalRegular', backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, fontSize: 16, color: colors.ink, marginBottom: 8, borderWidth: 1, borderColor: colors.line, textAlign: 'right' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btn: { padding: 12, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', borderWidth: 1, borderColor: colors.line, minWidth: 60 },
  btnActiveGreen: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  btnText: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.ink, fontWeight: '700' },
  btnTextActive: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.primary, fontWeight: '900' },
  textarea: { fontFamily: 'TajawalRegular', backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, fontSize: 16, color: colors.ink, textAlignVertical: 'top', minHeight: 90, borderWidth: 1, borderColor: colors.line, textAlign: 'right' },
  button: { backgroundColor: colors.gold, borderRadius: radius.md, padding: 16, alignItems: 'center', marginTop: 26, ...shadow },
  buttonText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 18, fontWeight: '900' },
  warn: { color: colors.warning, backgroundColor: colors.goldSoft, padding: 12, borderRadius: radius.sm, marginBottom: 8 },
});
