import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMe } from '../api/auth';
import { apiErrorMessage } from '../utils/errors';
import Loading from '../components/loading';
import { APP_VERSION } from '../utils/constants';

export default function ProfileScreen() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        setError(null);
        try {
          const me = await getMe();
          if (!cancelled) setUser(me);
        } catch (e: any) {
          if (!cancelled) setError(apiErrorMessage(e, 'تعذر تحميل البيانات'));
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, []),
  );

  if (loading) return <Loading />;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.fullName?.charAt(0) || '?'}</Text>
        </View>
        <Text style={styles.name}>{user?.fullName || '—'}</Text>
        <Text style={styles.username}>@{user?.username || '—'}</Text>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => setLoading(true)} style={styles.retryBtn}>
            <Text style={styles.retryText}>إعادة المحاولة</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.section}>
        <InfoRow label="الدور" value={user?.roles?.length ? user.roles.join('، ') : '—'} />
        <InfoRow label="الصلاحيات" value={`${user?.permissions?.length || 0} صلاحية`} />
        {user?.organizationId && <InfoRow label="معرّف المنشأة" value={user.organizationId.substring(0, 8) + '…'} />}
      </View>

      <View style={styles.section}>
        <InfoRow label="إصدار التطبيق" value="1.0.0" />
        <InfoRow label="المنصة" value="React Native (Expo)" />
      </View>

      <View style={styles.section}>
        <InfoRow label="إصدار التطبيق" value="1.0.0" />
        <InfoRow label="المنصة" value="React Native (Expo)" />
      </View>

      <View style={styles.section}>
        <InfoRow label="إصدار التطبيق" value={APP_VERSION} />
        <InfoRow label="المنصة" value="React Native (Expo)" />
      </View>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  header: { backgroundColor: '#1a73e8', padding: 30, alignItems: 'center' },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarText: { fontSize: 32, color: '#fff', fontWeight: 'bold' },
  name: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  username: { fontSize: 16, color: '#fff', opacity: 0.8, marginTop: 4 },
  section: { backgroundColor: '#fff', margin: 16, borderRadius: 12, overflow: 'hidden' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f0f4f8' },
  infoLabel: { fontSize: 16, color: '#666' },
  infoValue: { fontSize: 16, color: '#333', fontWeight: '500' },
  errorBox: { backgroundColor: '#fef2f2', margin: 16, padding: 16, borderRadius: 10, alignItems: 'center' },
  errorText: { color: '#ea4335', fontSize: 14, textAlign: 'center' },
  retryBtn: { marginTop: 10, padding: 8 },
  retryText: { color: '#1a73e8', fontSize: 14, fontWeight: '600' },
});
