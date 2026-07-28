import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { createFollowup } from '../api/endpoints';
import { enqueueMutation } from '../db/database';

const FOLLOWUP_TYPES = [
  { id: 'visit', name: 'زيارة ميدانية' },
  { id: 'call', name: 'اتصال هاتفي' },
  { id: 'message', name: 'رسالة نصية' },
];

export default function NewFollowupScreen({ route, navigation }: any) {
  const customerId = route.params?.customerId || '';
  const [typeId, setTypeId] = useState('');
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = { customerId, typeId, notes, followupAt: new Date().toISOString() };
      if (customerId) {
        return createFollowup(payload);
      }
      const opId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await enqueueMutation(opId, 'POST', '/followups', payload);
      return { data: { id: opId } };
    },
    onSuccess: () => {
      Alert.alert('تم', 'تم تسجيل المتابعة');
      navigation.goBack();
    },
    onError: (err: any) => {
      Alert.alert('خطأ', err.response?.data?.message || 'فشل تسجيل المتابعة');
    },
  });

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.label}>نوع المتابعة</Text>
      <View style={styles.typeRow}>
        {FOLLOWUP_TYPES.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[styles.typeBtn, typeId === t.id && styles.typeBtnActive]}
            onPress={() => setTypeId(t.id)}
          >
            <Text style={[styles.typeText, typeId === t.id && styles.typeTextActive]}>{t.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

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

      <TouchableOpacity style={styles.button} onPress={() => mutation.mutate()} disabled={!typeId || mutation.isPending}>
        <Text style={styles.buttonText}>{mutation.isPending ? 'جارٍ الحفظ...' : 'حفظ'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8', padding: 16 },
  label: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8, marginTop: 16 },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeBtn: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', borderWidth: 1, borderColor: '#ddd' },
  typeBtnActive: { backgroundColor: '#1a73e8', borderColor: '#1a73e8' },
  typeText: { color: '#333' },
  typeTextActive: { color: '#fff' },
  textarea: { backgroundColor: '#fff', borderRadius: 10, padding: 14, fontSize: 16, color: '#333', textAlignVertical: 'top', minHeight: 100 },
  button: { backgroundColor: '#1a73e8', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
