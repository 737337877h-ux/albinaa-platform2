import React, { useState } from 'react';
import { View, Text, Switch, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../store/auth-context';
import { requestGpsPermission, requestBackgroundGpsPermission, startGpsTracking, stopGpsTracking } from '../utils/gps';
import { SYNC_INTERVAL_MS } from '../utils/constants';

export default function SettingsScreen() {
  const { logout } = useAuth();
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [backgroundSync, setBackgroundSync] = useState(true);

  const toggleGps = async (value: boolean) => {
    if (value) {
      const ok = await requestGpsPermission();
      if (!ok) { Alert.alert('خطأ', 'لم يتم منح صلاحية GPS'); return; }
      const bgOk = await requestBackgroundGpsPermission();
      if (bgOk) startGpsTracking();
      setGpsEnabled(true);
    } else {
      stopGpsTracking();
      setGpsEnabled(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>تتبع الموقع</Text>
        <SettingRow label="تفعيل GPS" value={gpsEnabled} onChange={toggleGps} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>المزامنة</Text>
        <SettingRow label="مزامنة الخلفية" value={backgroundSync} onChange={setBackgroundSync} />
        <Text style={styles.hint}>كل {SYNC_INTERVAL_MS / 1000} ثانية</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>الحساب</Text>
        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutText}>تسجيل خروج</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SettingRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: '#ddd', true: '#1a73e8' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8', padding: 16 },
  section: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#333', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  label: { fontSize: 16, color: '#333' },
  hint: { fontSize: 12, color: '#999', marginTop: 4 },
  logoutBtn: { padding: 14, alignItems: 'center', backgroundColor: '#fee', borderRadius: 10, marginTop: 8 },
  logoutText: { color: '#ea4335', fontSize: 16, fontWeight: '600' },
});
