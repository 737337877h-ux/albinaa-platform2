import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator } from 'react-native';
import {
  getBaseUrl,
  getDefaultBaseUrl,
  getStoredBaseUrl,
  isValidBaseUrl,
  setStoredBaseUrl,
  clearStoredBaseUrl,
  testConnection,
} from '../config/api';
import { resetClient } from '../api/client';
import { clearTokens } from '../utils/secure-storage';

export default function ServerSettingsScreen() {
  const [current, setCurrent] = useState('');
  const [stored, setStored] = useState<string | null>(null);
  const [defaultUrl, setDefaultUrl] = useState('');
  const [draft, setDraft] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; status?: number; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const cur = await getBaseUrl();
      const sto = await getStoredBaseUrl();
      const def = getDefaultBaseUrl();
      setCurrent(cur);
      setStored(sto);
      setDefaultUrl(def);
      setDraft(sto || cur);
    })();
  }, []);

  const handleTest = async () => {
    if (!isValidBaseUrl(draft)) {
      Alert.alert('عنوان غير صالح', 'يجب أن يبدأ بـ http:// أو https://');
      return;
    }
    setTesting(true);
    setTestResult(null);
    const result = await testConnection(draft);
    setTesting(false);
    setTestResult(result);
  };

  const handleSave = async () => {
    if (!isValidBaseUrl(draft)) {
      Alert.alert('عنوان غير صالح', 'يجب أن يبدأ بـ http:// أو https://');
      return;
    }
    setSaving(true);
    try {
      await setStoredBaseUrl(draft);
      await resetClient();
      // مسح التوكنات لأن الجلسة على الخادم القديم لم تعد صالحة
      await clearTokens();
      const cur = await getBaseUrl();
      setCurrent(cur);
      setStored(draft);
      setTestResult(null);
      Alert.alert(
        'تم الحفظ',
        'تم تحديث عنوان الخادم. سيتم تسجيل الخروج للدخول إلى الخادم الجديد.',
        [{ text: 'حسناً', onPress: () => {} }],
      );
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await clearStoredBaseUrl();
      await resetClient();
      await clearTokens();
      const cur = await getBaseUrl();
      setCurrent(cur);
      setStored(null);
      setDraft(cur);
      setTestResult(null);
      Alert.alert('تم', 'تمت العودة إلى العنوان الافتراضي');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>الحالة الحالية</Text>
        <InfoRow label="العنوان المستخدم الآن" value={current} />
        {stored ? (
          <InfoRow label="عنوان محفوظ" value={stored} />
        ) : (
          <Text style={styles.note}>لا يوجد عنوان محفوظ — يُستخدم الافتراضي</Text>
        )}
        <InfoRow label="العنوان الافتراضي" value={defaultUrl} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>تغيير عنوان الخادم</Text>
        <Text style={styles.label}>عنوان API</Text>
        <TextInput
          style={styles.input}
          placeholder="http://192.168.x.x:3000"
          placeholderTextColor="#999"
          value={draft}
          onChangeText={(t) => { setDraft(t); setTestResult(null); }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnTest]}
            onPress={handleTest}
            disabled={testing}
          >
            {testing ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>اختبار الاتصال</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSave]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>حفظ</Text>}
          </TouchableOpacity>
        </View>

        {testResult && (
          <View style={[styles.result, testResult.ok ? styles.resultOk : styles.resultFail]}>
            <Text style={styles.resultText}>
              {testResult.ok
                ? `✓ الاتصال ناجح${testResult.status ? ` (HTTP ${testResult.status})` : ''}`
                : `✗ فشل الاتصال: ${testResult.error || 'خطأ غير معروف'}`}
            </Text>
          </View>
        )}

        <TouchableOpacity style={[styles.btn, styles.btnReset]} onPress={handleReset} disabled={saving}>
          <Text style={styles.btnText}>العودة إلى الافتراضي</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>ملاحظات</Text>
        <Text style={styles.note}>• عند الحفظ ستُمسح الجلسة الحالية ويجب تسجيل الدخول مجدداً.</Text>
        <Text style={styles.note}>• يجب أن يبدأ العنوان بـ http:// أو https://.</Text>
        <Text style={styles.note}>• في وضع التطوير استخدم http://localhost:3000 أو http://IP:3000.</Text>
        <Text style={styles.note}>• للإنتاج استخدم https:// فقط.</Text>
      </View>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8', padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 12 },
  infoRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f4f8' },
  infoLabel: { fontSize: 12, color: '#999', marginBottom: 2 },
  infoValue: { fontSize: 14, color: '#333', fontWeight: '500' },
  label: { fontSize: 14, color: '#666', marginBottom: 6, marginTop: 8 },
  input: { backgroundColor: '#f7f9fc', borderRadius: 8, padding: 12, fontSize: 15, color: '#333', borderWidth: 1, borderColor: '#e0e6ed' },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center' },
  btnTest: { backgroundColor: '#34a853' },
  btnSave: { backgroundColor: '#1a73e8' },
  btnReset: { backgroundColor: '#ea4335', marginTop: 12 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  result: { marginTop: 12, padding: 10, borderRadius: 8 },
  resultOk: { backgroundColor: '#e8f5e9' },
  resultFail: { backgroundColor: '#fdecea' },
  resultText: { fontSize: 13, color: '#333', textAlign: 'center' },
  note: { fontSize: 12, color: '#666', marginTop: 4, lineHeight: 18 },
});
