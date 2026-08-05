import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../store/auth-context';
import { APP_VERSION } from '../utils/constants';

export default function ProfileScreen({ navigation }: any) {
  const { user } = useAuth();

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.fullName?.charAt(0) || '?'}</Text>
        </View>
        <Text style={styles.name}>{user?.fullName || '—'}</Text>
        <Text style={styles.username}>@{user?.username || '—'}</Text>
        <Text style={styles.offlineHint}>هذه الهوية محفوظة بأمان للعمل دون اتصال</Text>
      </View>

      <View style={styles.section}>
        <InfoRow label="الدور" value={user?.roles?.length ? user.roles.join('، ') : '—'} />
        <InfoRow label="الصلاحيات" value={`${user?.permissions?.length || 0} صلاحية`} />
        {user?.organizationId && <InfoRow label="معرّف المنشأة" value={`${user.organizationId.substring(0, 8)}…`} />}
      </View>

      <TouchableOpacity style={styles.settingsBtn} onPress={() => navigation.navigate('Settings')}>
        <Text style={styles.settingsText}>إعدادات الاتصال والمزامنة والتنبيهات</Text>
      </TouchableOpacity>

      <View style={styles.section}>
        <InfoRow label="إصدار التطبيق" value={APP_VERSION} />
        <InfoRow label="وضع البيانات" value="قاعدة محلية + مزامنة آمنة" />
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
  container: { flex: 1, backgroundColor: '#F2F6F4' },
  header: { backgroundColor: '#0A4A3C', padding: 30, alignItems: 'center' },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarText: { fontSize: 32, color: '#0A4A3C', fontWeight: 'bold' },
  name: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  username: { fontSize: 16, color: '#D7EAE4', marginTop: 4 },
  offlineHint: { fontSize: 12, color: '#B7D8CF', marginTop: 10 },
  section: { backgroundColor: '#fff', margin: 16, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#E0E9E5' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#EEF3F1' },
  infoLabel: { fontSize: 15, color: '#667A74' },
  infoValue: { fontSize: 15, color: '#113C33', fontWeight: '600' },
  settingsBtn: { marginHorizontal: 16, backgroundColor: '#0A604D', borderRadius: 12, padding: 16, alignItems: 'center' },
  settingsText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
