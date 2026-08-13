import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../store/auth-context';
import { APP_VERSION } from '../utils/constants';
import { colors, radius, shadow } from '../theme';

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
      <View style={styles.quickRow}>
        <TouchableOpacity style={styles.quickBtn} onPress={() => navigation.navigate('FollowupsList')}><Text style={styles.quickText}>المتابعات</Text></TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn} onPress={() => navigation.navigate('PromisesList')}><Text style={styles.quickText}>وعود السداد</Text></TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.templatesBtn} onPress={() => navigation.navigate('MessageTemplates')}><Text style={styles.templatesText}>قوالب واتساب والرسائل النصية</Text></TouchableOpacity>
      <TouchableOpacity style={styles.templatesBtn} onPress={() => navigation.navigate('Reservations')}><Text style={styles.templatesText}>حجوزات البضاعة ومتوسط سعر الطن</Text></TouchableOpacity>

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
  container: { flex: 1, backgroundColor: colors.background },
  header: { backgroundColor: colors.primary, padding: 30, alignItems: 'center' },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.gold, justifyContent: 'center', alignItems: 'center', marginBottom: 12, ...shadow },
  avatarText: { fontSize: 32, color: colors.primary, fontWeight: '900' },
  name: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  username: { fontSize: 16, color: colors.warmGray, marginTop: 4 },
  offlineHint: { fontSize: 12, color: '#DCE8E5', marginTop: 10, textAlign: 'center' },
  section: { backgroundColor: colors.surface, margin: 16, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, ...shadow },
  infoRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  infoLabel: { fontSize: 15, color: colors.muted },
  infoValue: { fontSize: 15, color: colors.primary, fontWeight: '700' },
  settingsBtn: { marginHorizontal: 16, backgroundColor: colors.gold, borderRadius: radius.md, padding: 16, alignItems: 'center', ...shadow },
  settingsText: { color: colors.primary, fontSize: 15, fontWeight: '900' },
  quickRow: { flexDirection: 'row-reverse', gap: 8, marginHorizontal: 16, marginTop: 10 },
  quickBtn: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, alignItems: 'center' },
  quickText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  templatesBtn: { marginHorizontal: 16, marginTop: 8, backgroundColor: colors.goldSoft, borderRadius: radius.md, padding: 14, alignItems: 'center' },
  templatesText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
});
