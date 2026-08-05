import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  KeyboardAvoidingView, Platform, Modal, ActivityIndicator, ScrollView,
} from 'react-native';
import { useAuth } from '../store/auth-context';
import {
  getBaseUrl, getStoredBaseUrl, getDefaultBaseUrl,
  setStoredBaseUrl, clearStoredBaseUrl, pingServer, isValidBaseUrl, ServerHealth,
} from '../config/api';
import { resetClient } from '../api/client';
import { clearSession } from '../utils/secure-storage';
import { APP_VERSION } from '../utils/constants';

export default function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');
  const [storedUrl, setStoredUrl] = useState<string | null>(null);
  const [defaultUrl, setDefaultUrl] = useState('');

  useEffect(() => {
    (async () => {
      const cur = await getBaseUrl();
      setCurrentUrl(cur);
      setStoredUrl(await getStoredBaseUrl());
      setDefaultUrl(getDefaultBaseUrl());
    })();
  }, []);

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      Alert.alert('تنبيه', 'يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err: any) {
      const status = err.response?.status;
      let msg = 'فشل تسجيل الدخول';
      if (status === 401) msg = 'اسم المستخدم أو كلمة المرور غير صحيحة';
      else if (status === 404) msg = 'الخادم لا يستجيب — تحقق من عنوان الخادم';
      else if (!err.response) msg = 'تعذر الاتصال بالخادم — تحقق من عنوان الخادم أو الاتصال بالشبكة';
      else if (err.response?.data?.message) msg = err.response.data.message;
      Alert.alert('خطأ', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.logo}>البناء الراقي تحصيل</Text>
        <Text style={styles.subtitle}>أساس تثق فيه</Text>
        <TextInput
          style={styles.input}
          placeholder="اسم المستخدم"
          placeholderTextColor="#999"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder="كلمة المرور"
          placeholderTextColor="#999"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'جارٍ تسجيل الدخول...' : 'تسجيل الدخول'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.serverLink} onPress={() => setSettingsOpen(true)}>
          <Text style={styles.serverLinkText} numberOfLines={1} ellipsizeMode="middle">
            ⚙ {currentUrl || 'تغيير الخادم'}
          </Text>
        </TouchableOpacity>
      </View>

      <ServerSettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentUrl={currentUrl}
        storedUrl={storedUrl}
        defaultUrl={defaultUrl}
        onSaved={async (newUrl) => {
          setCurrentUrl(newUrl);
          setStoredUrl(newUrl);
          setSettingsOpen(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}

interface SettingsProps {
  visible: boolean;
  onClose: () => void;
  currentUrl: string;
  storedUrl: string | null;
  defaultUrl: string;
  onSaved: (newUrl: string) => void;
}

function ServerSettingsModal({ visible, onClose, currentUrl, storedUrl, defaultUrl, onSaved }: SettingsProps) {
  const [draft, setDraft] = useState(currentUrl);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ServerHealth | null>(null);
  const [autoResult, setAutoResult] = useState<ServerHealth | null>(null);

  useEffect(() => {
    if (visible) {
      setDraft(currentUrl);
      setResult(null);
      // auto-test current URL when opening
      setTesting(true);
      pingServer(currentUrl).then((h) => { setTesting(false); setAutoResult(h); });
    }
  }, [visible, currentUrl]);

  const handleTest = async () => {
    if (!isValidBaseUrl(draft)) {
      setResult({ ok: false, error: 'العنوان يجب أن يبدأ بـ http:// أو https://' });
      return;
    }
    setTesting(true);
    setResult(null);
    const r = await pingServer(draft);
    setTesting(false);
    setResult(r);
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
      await clearSession();
      onSaved(draft);
      Alert.alert('تم', 'تم تحديث العنوان. سجّل الدخول من جديد.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await clearStoredBaseUrl();
      await resetClient();
      await clearSession();
      onSaved(defaultUrl);
      setDraft(defaultUrl);
      setResult(null);
      Alert.alert('تم', 'تمت العودة إلى العنوان الافتراضي');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>إعدادات الخادم</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.modalClose}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Status / current state */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>الحالة</Text>
          <StatusRow
            label="الحالي"
            value={currentUrl}
            health={autoResult}
            loading={testing && !result}
          />
          {storedUrl ? (
            <StatusRow label="محفوظ" value={storedUrl} />
          ) : (
            <Text style={styles.note}>لا يوجد عنوان محفوظ</Text>
          )}
          <InfoRow label="الافتراضي" value={defaultUrl} />
          <InfoRow label="إصدار التطبيق" value={APP_VERSION} />
        </View>

        {/* Editor */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>تغيير عنوان الخادم</Text>
          <Text style={styles.label}>Base URL</Text>
          <TextInput
            style={styles.input}
            placeholder="http://192.168.x.x:3000"
            placeholderTextColor="#999"
            value={draft}
            onChangeText={(t) => { setDraft(t); setResult(null); }}
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
              disabled={saving || !isValidBaseUrl(draft)}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>حفظ</Text>}
            </TouchableOpacity>
          </View>

          {result && <ResultBox result={result} />}
        </View>

        <TouchableOpacity style={[styles.btn, styles.btnReset, { marginHorizontal: 16, marginBottom: 16 }]} onPress={handleReset} disabled={saving}>
          <Text style={styles.btnText}>استعادة الافتراضي</Text>
        </TouchableOpacity>

        <View style={[styles.card, { marginBottom: 32 }]}>
          <Text style={styles.cardTitle}>ملاحظات</Text>
          <Text style={styles.note}>• عند الحفظ تُمسح الجلسة ويُطلب تسجيل الدخول مجدداً.</Text>
          <Text style={styles.note}>• في الإنتاج استخدم https:// فقط.</Text>
          <Text style={styles.note}>• لا حاجة لإعادة بناء التطبيق عند تغير IP الخادم.</Text>
        </View>
      </ScrollView>
    </Modal>
  );
}

function StatusRow({ label, value, health, loading }: { label: string; value: string; health?: ServerHealth | null; loading?: boolean }) {
  return (
    <View style={styles.statusRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.statusLabel}>{label}</Text>
        <Text style={styles.statusValue} selectable numberOfLines={1} ellipsizeMode="middle">{value}</Text>
      </View>
      {loading ? (
        <ActivityIndicator color="#1a73e8" size="small" />
      ) : health ? (
        <View style={styles.healthBlock}>
          <Text style={[styles.statusBadge, health.ok ? styles.badgeOk : styles.badgeFail]}>
            {health.ok ? '✓ متصل' : '✗ غير متصل'}
          </Text>
          {health.latencyMs != null && <Text style={styles.pingText}>{health.latencyMs} ms</Text>}
        </View>
      ) : null}
    </View>
  );
}

function ResultBox({ result }: { result: ServerHealth }) {
  if (result.ok) {
    return (
      <View style={[styles.resultBox, styles.resultOk]}>
        <Text style={styles.resultTitle}>✓ تم الاتصال بالخادم بنجاح</Text>
        <View style={styles.resultGrid}>
          {result.status && <InfoLine label="HTTP" value={String(result.status)} />}
          {result.latencyMs != null && <InfoLine label="الاستجابة" value={`${result.latencyMs} ms`} />}
          {result.version && <InfoLine label="إصدار الـAPI" value={result.version} />}
          {result.environment && <InfoLine label="البيئة" value={result.environment} />}
          {result.uptimeSeconds != null && <InfoLine label="مدة التشغيل" value={`${result.uptimeSeconds} ثانية`} />}
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.resultBox, styles.resultFail]}>
      <Text style={styles.resultTitle}>✗ فشل الاتصال</Text>
      <Text style={styles.resultError}>{result.error || 'سبب غير معروف'}</Text>
    </View>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLineLabel}>{label}</Text>
      <Text style={styles.infoLineValue}>{value}</Text>
    </View>
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
  container: { flex: 1, justifyContent: 'center', backgroundColor: '#f0f4f8', padding: 20 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
  logo: { fontSize: 28, fontWeight: 'bold', color: '#1a73e8', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 32 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 16, color: '#333', textAlign: 'right' },
  button: { backgroundColor: '#1a73e8', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  serverLink: { marginTop: 16, padding: 10, alignItems: 'center' },
  serverLinkText: { color: '#1a73e8', fontSize: 12 },

  // Modal
  modalContainer: { flex: 1, backgroundColor: '#f0f4f8' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#1a73e8', paddingTop: 50 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  modalClose: { color: '#fff', fontSize: 22, fontWeight: '600', padding: 4 },

  // Cards
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 10 },
  label: { fontSize: 13, color: '#666', marginBottom: 6, marginTop: 8 },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center' },
  btnTest: { backgroundColor: '#34a853' },
  btnSave: { backgroundColor: '#1a73e8' },
  btnReset: { backgroundColor: '#ea4335' },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  note: { fontSize: 12, color: '#666', marginTop: 4, lineHeight: 18 },

  // Status row
  statusRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f4f8' },
  statusLabel: { fontSize: 11, color: '#999', marginBottom: 2 },
  statusValue: { fontSize: 13, color: '#333', fontWeight: '500' },
  healthBlock: { alignItems: 'flex-end' },
  statusBadge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  badgeOk: { color: '#fff', backgroundColor: '#34a853' },
  badgeFail: { color: '#fff', backgroundColor: '#ea4335' },
  pingText: { fontSize: 10, color: '#999', marginTop: 2 },

  // Info
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  infoLabel: { fontSize: 12, color: '#999' },
  infoValue: { fontSize: 12, color: '#333', maxWidth: '70%' },

  // Result box
  resultBox: { marginTop: 12, padding: 12, borderRadius: 8 },
  resultOk: { backgroundColor: '#e8f5e9' },
  resultFail: { backgroundColor: '#fdecea' },
  resultTitle: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8 },
  resultError: { fontSize: 13, color: '#b71c1c' },
  resultGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  infoLine: { minWidth: '45%' },
  infoLineLabel: { fontSize: 11, color: '#999' },
  infoLineValue: { fontSize: 13, color: '#333', fontWeight: '500' },
});
