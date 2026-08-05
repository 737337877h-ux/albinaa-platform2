import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View,
} from 'react-native';
import { useAuth } from '../store/auth-context';
import { useSync } from '../store/sync-context';
import {
  getBaseUrl, getLanOnlySync, isLocalNetworkUrl, setLanOnlySync,
} from '../config/api';
import {
  requestGpsPermission, requestBackgroundGpsPermission, startGpsTracking, stopGpsTracking,
} from '../utils/gps';
import { APP_VERSION, SYNC_INTERVAL_MS } from '../utils/constants';
import {
  areLocalNotificationsEnabled, disableLocalNotifications,
  initializeLocalNotifications, rescheduleOfflineReminders,
} from '../utils/local-notifications';

const PHASE_LABELS = {
  idle: 'جاهز', syncing: 'جارٍ المزامنة', synced: 'تمت المزامنة', offline: 'دون اتصال', error: 'تحتاج مراجعة',
};

export default function SettingsScreen() {
  const { logout } = useAuth();
  const { status, triggerSync, retryBlocked, refreshStatus } = useSync();
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [lanOnly, setLanOnly] = useState(true);
  const [baseUrl, setBaseUrl] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  useEffect(() => {
    Promise.all([getLanOnlySync(), getBaseUrl(), areLocalNotificationsEnabled()]).then(([localOnly, url, alertsEnabled]) => {
      setLanOnly(localOnly);
      setBaseUrl(url);
      setNotificationsEnabled(alertsEnabled);
    });
    refreshStatus().catch(() => undefined);
  }, [refreshStatus]);

  const toggleGps = async (value: boolean) => {
    if (value) {
      const ok = await requestGpsPermission();
      if (!ok) { Alert.alert('خطأ', 'لم يتم منح صلاحية الموقع'); return; }
      const background = await requestBackgroundGpsPermission();
      if (background) await startGpsTracking();
      setGpsEnabled(true);
    } else {
      await stopGpsTracking();
      setGpsEnabled(false);
    }
  };

  const toggleLanOnly = async (value: boolean) => {
    await setLanOnlySync(value);
    setLanOnly(value);
    await refreshStatus();
  };

  const enableNotifications = async () => {
    const granted = await initializeLocalNotifications();
    setNotificationsEnabled(granted);
    if (!granted) {
      Alert.alert('التنبيهات غير مفعلة', 'اسمح للتطبيق بعرض الإشعارات من إعدادات الهاتف.');
      return;
    }
    const count = await rescheduleOfflineReminders();
    Alert.alert('تم تفعيل التنبيهات', `تم إعداد ${count} تنبيه من البيانات المحفوظة على الهاتف.`);
  };

  const toggleNotifications = async (value: boolean) => {
    if (value) await enableNotifications();
    else {
      await disableLocalNotifications();
      setNotificationsEnabled(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <View style={styles.titleRow}>
          <Text style={styles.sectionTitle}>حالة المزامنة</Text>
          <View style={[styles.badge, status.phase === 'synced' ? styles.badgeOk : styles.badgeWarn]}>
            <Text style={styles.badgeText}>{PHASE_LABELS[status.phase]}</Text>
          </View>
        </View>
        <InfoRow label="الخادم" value={baseUrl || '—'} />
        <InfoRow label="نوع الاتصال" value={isLocalNetworkUrl(baseUrl) ? 'شبكة محلية' : 'خارجي'} />
        <InfoRow
          label="آخر مزامنة"
          value={status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString('ar-YE') : 'لم تتم بعد'}
        />
        <InfoRow label="عمليات بانتظار الإرسال" value={String(status.pending)} />
        <InfoRow label="عمليات تحتاج مراجعة" value={String(status.blocked)} danger={status.blocked > 0} />
        {!!status.lastError && <Text style={styles.errorText}>{status.lastError}</Text>}
        <TouchableOpacity
          style={[styles.primaryBtn, status.phase === 'syncing' && styles.disabledBtn]}
          onPress={triggerSync}
          disabled={status.phase === 'syncing'}
        >
          {status.phase === 'syncing'
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryBtnText}>مزامنة الآن</Text>}
        </TouchableOpacity>
        {status.blocked > 0 && (
          <TouchableOpacity style={styles.outlineBtn} onPress={retryBlocked}>
            <Text style={styles.outlineBtnText}>إعادة محاولة العمليات المراجعة</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>الاتصال المحلي</Text>
        <SettingRow label="المزامنة عبر الشبكة المحلية فقط" value={lanOnly} onChange={toggleLanOnly} />
        <Text style={styles.hint}>
          عند التفعيل لا يرسل التطبيق أي بيانات إلى عنوان خارجي. يعمل تلقائيًا كل {SYNC_INTERVAL_MS / 1000} ثانية عند توفر الخادم المحلي.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>التنبيهات</Text>
        <SettingRow label="تنبيهات المهام والوعود" value={notificationsEnabled} onChange={toggleNotifications} />
        <TouchableOpacity style={styles.outlineBtn} onPress={enableNotifications}>
          <Text style={styles.outlineBtnText}>تحديث التنبيهات الآن</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>تعمل التنبيهات من قاعدة الهاتف حتى بدون إنترنت.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>الموقع</Text>
        <SettingRow label="تسجيل موقع الزيارة" value={gpsEnabled} onChange={toggleGps} />
      </View>

      <View style={styles.section}>
        <InfoRow label="إصدار التطبيق" value={APP_VERSION} />
        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutText}>تسجيل خروج</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function SettingRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: '#d8dedb', true: '#0A8064' }} />
    </View>
  );
}

function InfoRow({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, danger && styles.danger]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F6F4' },
  content: { padding: 16, paddingBottom: 40 },
  section: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: '#E0E9E5' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#113C33', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  label: { fontSize: 15, color: '#244B43', flex: 1, textAlign: 'right' },
  hint: { fontSize: 12, color: '#667A74', marginTop: 8, lineHeight: 19, textAlign: 'right' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#EEF3F1' },
  infoLabel: { fontSize: 13, color: '#667A74' },
  infoValue: { flex: 1, fontSize: 13, color: '#113C33', fontWeight: '600', textAlign: 'left' },
  danger: { color: '#B42318' },
  errorText: { color: '#B42318', backgroundColor: '#FEF3F2', padding: 10, borderRadius: 8, marginTop: 10, textAlign: 'right' },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  badgeOk: { backgroundColor: '#DDF7EC' },
  badgeWarn: { backgroundColor: '#FFF1D6' },
  badgeText: { color: '#113C33', fontSize: 12, fontWeight: '700' },
  primaryBtn: { backgroundColor: '#0A604D', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 14 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  disabledBtn: { opacity: 0.65 },
  outlineBtn: { borderColor: '#0A604D', borderWidth: 1, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 10 },
  outlineBtnText: { color: '#0A604D', fontWeight: '700' },
  logoutBtn: { padding: 14, alignItems: 'center', backgroundColor: '#FEF3F2', borderRadius: 10, marginTop: 16 },
  logoutText: { color: '#B42318', fontSize: 16, fontWeight: '700' },
});
