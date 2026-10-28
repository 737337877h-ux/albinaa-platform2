import React, { useEffect, useState } from 'react';
import { isOperationsApp, product } from '../config/product';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useAuth } from '../store/auth-context';
import { useSync } from '../store/sync-context';
import {
  getBaseUrl, getLanOnlySync, isLocalNetworkUrl, isValidBaseUrl, pingServer,
  setLanOnlySync, setStoredBaseUrl,
} from '../config/api';
import { resetClient } from '../api/client';
import {
  getWorkplace, requestGpsPermission, requestBackgroundGpsPermission, restoreGpsTracking,
  setCurrentLocationAsWorkplace, startGpsTracking, stopGpsTracking,
} from '../utils/gps';
import * as LocalAuthentication from 'expo-local-authentication';
import { isBiometricEnabled, setBiometricEnabled } from '../utils/secure-storage';
import { APP_VERSION, SYNC_INTERVAL_MS } from '../utils/constants';
import {
  areLocalNotificationsEnabled, disableLocalNotifications,
  getNotificationSoundPreference, initializeLocalNotifications, NotificationSoundPreference,
  rescheduleOfflineReminders, setNotificationSoundPreference,
} from '../utils/local-notifications';
import { colors, radius, shadow } from '../theme';
import { BlockedMutationDiagnostic, discardBlockedMutations, getBlockedMutationDiagnostics } from '../db/database';
import {
  currentBuildNumber, downloadAndInstallMobileUpdate, fetchAvailableMobileUpdate,
  MobileAppRelease, showUpdateError,
} from '../utils/mobile-update';

const PHASE_LABELS = {
  idle: 'جاهز', syncing: 'جارٍ المزامنة', synced: 'تمت المزامنة', offline: 'دون اتصال', error: 'تحتاج مراجعة',
};

export default function SettingsScreen() {
  const { user, login, logout } = useAuth();
  const { status, triggerSync, retryPending, retryBlocked, refreshStatus } = useSync();
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [lanOnly, setLanOnly] = useState(true);
  const [baseUrl, setBaseUrl] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [biometricEnabled, setBiometric] = useState(false);
  const [workplaceSet, setWorkplaceSet] = useState(false);
  const [notificationSound, setNotificationSound] = useState<NotificationSoundPreference>('news');
  const [accountModal, setAccountModal] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [serverDraft, setServerDraft] = useState('');
  const [usernameDraft, setUsernameDraft] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [blockedDiagnostics, setBlockedDiagnostics] = useState<BlockedMutationDiagnostic[]>([]);
  const [availableUpdate, setAvailableUpdate] = useState<MobileAppRelease | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState({ written: 0, total: 0, fraction: 0 });

  const checkForUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const release = await fetchAvailableMobileUpdate();
      setAvailableUpdate(release);
      if (!release) Alert.alert('التطبيق محدّث', 'لا يوجد إصدار أحدث منشور حاليًا.');
    } catch (error: any) {
      Alert.alert('تعذر فحص التحديث', error?.message || 'اتصل بالشبكة المحلية ثم حاول مرة أخرى.');
    } finally { setCheckingUpdate(false); }
  };

  const installUpdate = async () => {
    if (!availableUpdate) return;
    setInstallingUpdate(true);
    setUpdateProgress({ written: 0, total: availableUpdate.size, fraction: 0 });
    try { await downloadAndInstallMobileUpdate(availableUpdate, setUpdateProgress); }
    catch (error) { showUpdateError(error); }
    finally { setInstallingUpdate(false); }
  };

  const discardBlocked = () => {
    Alert.alert(
      'حذف العمليات المرفوضة',
      `سيتم حذف ${status.blocked} عملية مرفوضة من هذا الهاتف فقط.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف', style: 'destructive', onPress: async () => {
            const removed = await discardBlockedMutations();
            setBlockedDiagnostics([]);
            await refreshStatus();
            await triggerSync();
            Alert.alert('تم التنظيف', `حُذفت ${removed} عملية مرفوضة وأُعيدت المزامنة.`);
          },
        },
      ],
    );
  };

  useEffect(() => {
    Promise.all([getLanOnlySync(), getBaseUrl(), areLocalNotificationsEnabled(), isBiometricEnabled(), restoreGpsTracking(), getWorkplace(), getNotificationSoundPreference()]).then(([localOnly, url, alertsEnabled, biometric, gps, workplace, sound]) => {
      setLanOnly(localOnly);
      setBaseUrl(url);
      setNotificationsEnabled(alertsEnabled);
      setBiometric(biometric);
      setGpsEnabled(gps);
      setWorkplaceSet(!!workplace);
      setNotificationSound(sound);
      setServerDraft(url);
    });
    setUsernameDraft(user?.username || '');
    refreshStatus().catch(() => undefined);
  }, [refreshStatus, user?.username]);

  useEffect(() => {
    getBlockedMutationDiagnostics()
      .then(setBlockedDiagnostics)
      .catch(() => setBlockedDiagnostics([]));
  }, [status.blocked, status.lastSyncAt]);

  const switchAccountOrServer = async () => {
    const nextServer = serverDraft.trim().replace(/\/+$/, '');
    if (!isValidBaseUrl(nextServer) || !usernameDraft.trim() || !passwordDraft) {
      Alert.alert('بيانات ناقصة', 'أدخل عنوان خادم صحيحًا واسم المستخدم وكلمة المرور.');
      return;
    }
    setSwitching(true);
    const previousServer = baseUrl;
    try {
      const health = await pingServer(nextServer, 7000);
      if (!health.ok) throw new Error(health.error || 'تعذر الوصول إلى الخادم');
      await setStoredBaseUrl(nextServer);
      await resetClient();
      await login(usernameDraft.trim(), passwordDraft);
      setBaseUrl(nextServer);
      setPasswordDraft('');
      setAccountModal(false);
      await refreshStatus();
      triggerSync().catch(() => undefined);
      Alert.alert('تم التبديل', 'تم فتح الحساب الجديد، وسيعمل دون اتصال بعد اكتمال المزامنة الأولى.');
    } catch (error: any) {
      await setStoredBaseUrl(previousServer);
      await resetClient();
      Alert.alert('تعذر التبديل', error?.response?.data?.message || error?.message || 'تحقق من البيانات والاتصال');
    } finally {
      setSwitching(false);
    }
  };

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
    try {
      const count = await rescheduleOfflineReminders();
      Alert.alert('تم تفعيل التنبيهات', `تم إعداد ${count} تنبيه من البيانات المحفوظة على الهاتف.`);
    } catch { Alert.alert('التذكيرات', 'تعذر تحديث التذكيرات المحلية. مزامنة البيانات مستقلة وتستمر بشكل طبيعي.'); }
  };

  const toggleNotifications = async (value: boolean) => {
    if (value) await enableNotifications();
    else {
      await disableLocalNotifications();
      setNotificationsEnabled(false);
    }
  };

  const chooseNotificationSound = async (value: NotificationSoundPreference) => {
    await setNotificationSoundPreference(value);
    setNotificationSound(value);
    if (notificationsEnabled) await rescheduleOfflineReminders().catch(() => Alert.alert('التذكيرات', 'تعذر تحديث التذكيرات المحلية حاليًا'));
  };

  const toggleBiometric = async (value: boolean) => {
    if (value) {
      const available = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!available || !enrolled) { Alert.alert('البصمة غير جاهزة', 'أضف بصمة أو قفل شاشة من إعدادات الهاتف أولاً.'); return; }
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'تفعيل دخول الراقي بالبصمة', disableDeviceFallback: true, biometricsSecurityLevel: 'strong' });
      if (!result.success) return;
    }
    await setBiometricEnabled(value);
    setBiometric(value);
  };

  const saveWorkplace = async () => {
    try {
      const foreground = await requestGpsPermission();
      if (!foreground) throw new Error('لم يتم منح صلاحية الموقع');
      const background = await requestBackgroundGpsPermission();
      if (!background) throw new Error('اختر السماح بالموقع دائماً لتفعيل تنبيه الوصول');
      await setCurrentLocationAsWorkplace();
      setWorkplaceSet(true);
      Alert.alert('تم حفظ موقع العمل', 'سينبهك التطبيق عند الوصول لفتح التطبيق ومزامنة العمليات عبر الشبكة المحلية.');
    } catch (error: any) { Alert.alert('تعذر حفظ الموقع', error?.message || 'تحقق من إعدادات GPS'); }
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
        {status.reminderWarning ? <InfoRow label="التذكيرات" value={status.reminderWarning} /> : null}
        {status.phase === 'syncing' && status.stage ? <InfoRow label="المرحلة الحالية" value={status.stage} /> : null}
        <InfoRow
          label="آخر مزامنة"
          value={status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString('ar-YE') : 'لم تتم بعد'}
        />
        <InfoRow label="عمليات بانتظار الإرسال" value={String(status.pending)} />
        <InfoRow label="عمليات تحتاج مراجعة" value={String(status.blocked)} danger={status.blocked > 0} />
        {!!status.lastError && <Text style={styles.errorText}>{status.lastError}</Text>}
        <TouchableOpacity
          style={[styles.primaryBtn, status.phase === 'syncing' && styles.disabledBtn]}
          onPress={retryPending}
          disabled={status.phase === 'syncing'}
        >
          {status.phase === 'syncing'
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryBtnText}>مزامنة الآن</Text>}
        </TouchableOpacity>
        {status.blocked > 0 && (
          <>
            <TouchableOpacity style={styles.outlineBtn} onPress={retryBlocked}>
              <Text style={styles.outlineBtnText}>إعادة محاولة العمليات المراجعة</Text>
            </TouchableOpacity>
            <View style={styles.diagnosticsBox}>
              <Text style={styles.diagnosticsTitle}>تفاصيل العمليات المرفوضة</Text>
              {blockedDiagnostics.map((item, index) => (
                <View key={item.operationId} style={styles.diagnosticItem}>
                  <Text style={styles.diagnosticHeading}>عملية {index + 1}: {item.type.toUpperCase()} {item.endpoint}</Text>
                  <Text style={styles.diagnosticError}>{item.lastError || 'لم يسجل الخادم سببًا'}</Text>
                  <Text style={styles.diagnosticPayload}>{item.payloadSummary}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity style={styles.discardBtn} onPress={discardBlocked}>
              <Text style={styles.discardBtnText}>حذف العمليات المرفوضة من الهاتف</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>الاتصال المحلي</Text>
        <InfoRow label="المستخدم الحالي" value={user ? `${user.fullName} (@${user.username})` : '—'} />
        <SettingRow label="المزامنة عبر الشبكة المحلية فقط" value={lanOnly} onChange={toggleLanOnly} />
        <Text style={styles.hint}>
          عند التفعيل لا يرسل التطبيق أي بيانات إلى عنوان خارجي. يعمل تلقائيًا كل {SYNC_INTERVAL_MS / 60_000} دقائق عند توفر الخادم المحلي.
        </Text>
        <TouchableOpacity style={styles.outlineBtn} onPress={() => setAccountModal(true)}>
          <Text style={styles.outlineBtnText}>تبديل المستخدم أو الخادم</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>التنبيهات</Text>
        {isOperationsApp ? <Text style={styles.hint}>{product.pushConfigured ? 'تصلك إشعارات الطلبات ومهام الموظفين عند السماح بالإشعارات في إعدادات الهاتف، وتجد سجلها في شاشة الإشعارات داخل التطبيق.' : 'تجد إشعارات الطلبات ومهام الموظفين في شاشة الإشعارات داخل التطبيق. الإشعارات البعيدة لهذه النسخة ما زالت قيد التجهيز.'}</Text> : <>
        <SettingRow label="تنبيهات المهام والوعود" value={notificationsEnabled} onChange={toggleNotifications} />
        <Text style={styles.fieldLabel}>نغمة الإشعار</Text>
        <View style={styles.soundChoices}>
          <SoundChoice label="وميض الأخبار" active={notificationSound === 'news'} onPress={() => chooseNotificationSound('news')} />
          <SoundChoice label="الافتراضية" active={notificationSound === 'default'} onPress={() => chooseNotificationSound('default')} />
          <SoundChoice label="صامت" active={notificationSound === 'silent'} onPress={() => chooseNotificationSound('silent')} />
        </View>
        <TouchableOpacity style={styles.outlineBtn} onPress={enableNotifications}>
          <Text style={styles.outlineBtnText}>تحديث التنبيهات الآن</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>تعمل التنبيهات من قاعدة الهاتف حتى بدون إنترنت.</Text>
        </>}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>الموقع</Text>
        {!isOperationsApp && <SettingRow label="تسجيل موقع الزيارة" value={gpsEnabled} onChange={toggleGps} />}
        <TouchableOpacity style={styles.outlineBtn} onPress={saveWorkplace}>
          <Text style={styles.outlineBtnText}>{workplaceSet ? 'تحديث موقع العمل الحالي' : 'اعتماد موقعي الحالي كموقع العمل'}</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>عند دخول نطاق موقع العمل سيظهر تنبيه للمزامنة مع الخادم المحلي.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>الدخول والحماية</Text>
        <SettingRow label="فتح التطبيق بالبصمة" value={biometricEnabled} onChange={toggleBiometric} />
        <Text style={styles.hint}>بعد تسجيل الدخول أول مرة، تفتح البيانات المحفوظة بالبصمة حتى دون إنترنت.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>تحديث التطبيق</Text>
        <InfoRow label="الإصدار الحالي" value={`${APP_VERSION} (${currentBuildNumber()})`} />
        {availableUpdate && <View style={styles.updateBox}>
          <Text style={styles.updateTitle}>يتوفر الإصدار {availableUpdate.versionName}</Text>
          <Text style={styles.hint}>{availableUpdate.notes || 'تحسينات وإصلاحات جديدة.'}</Text>
          <TouchableOpacity style={styles.primaryBtn} disabled={installingUpdate} onPress={installUpdate}>
            {installingUpdate ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>تنزيل وتثبيت</Text>}
          </TouchableOpacity>
          {installingUpdate && <View style={styles.downloadProgressBox}>
            <View style={styles.downloadProgressTrack}><View style={[styles.downloadProgressFill, { width: `${Math.round(updateProgress.fraction * 100)}%` }]} /></View>
            <Text style={styles.downloadProgressText}>{Math.round(updateProgress.fraction * 100)}% · {(updateProgress.written / 1024 / 1024).toFixed(1)} من {(updateProgress.total / 1024 / 1024).toFixed(1)} م.ب</Text>
          </View>}
        </View>}
        <TouchableOpacity style={styles.outlineBtn} disabled={checkingUpdate} onPress={checkForUpdate}>
          {checkingUpdate ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.outlineBtnText}>فحص وجود تحديث</Text>}
        </TouchableOpacity>
        <Text style={styles.hint}>{isOperationsApp ? 'يُنزّل التحديث من قناة إدارة العملاء والمخزون المستقلة، ثم يطلب Android تأكيد التثبيت.' : 'يتم تنزيل الإصدار المنشور من خادم المنصة عبر الشبكة المحلية أو Tailscale، ثم يطلب Android تأكيد التثبيت.'}</Text>
        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutText}>تسجيل خروج</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={accountModal} transparent animationType="slide" onRequestClose={() => setAccountModal(false)}>
        <KeyboardAvoidingView style={styles.modalShade} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            contentContainerStyle={styles.modalScroll}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setAccountModal(false)}><Text style={styles.modalClose}>إغلاق</Text></TouchableOpacity>
              <Text style={styles.modalTitle}>تبديل الحساب والخادم</Text>
            </View>
            <Text style={styles.fieldLabel}>عنوان الخادم</Text>
            <TextInput style={styles.input} value={serverDraft} onChangeText={setServerDraft} autoCapitalize="none" keyboardType="url" textAlign="left" />
            <Text style={styles.fieldLabel}>اسم المستخدم</Text>
            <TextInput style={styles.input} value={usernameDraft} onChangeText={setUsernameDraft} autoCapitalize="none" textAlign="left" />
            <Text style={styles.fieldLabel}>كلمة المرور</Text>
            <TextInput style={styles.input} value={passwordDraft} onChangeText={setPasswordDraft} secureTextEntry textAlign="left" />
            <Text style={styles.hint}>يجب الاتصال بالخادم مرة واحدة عند إضافة هذا الحساب. بعد المزامنة الأولى تبقى بياناته منفصلة وآمنة للعمل دون إنترنت.</Text>
            <TouchableOpacity style={[styles.primaryBtn, switching && styles.disabledBtn]} disabled={switching} onPress={switchAccountOrServer}>
              {switching ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>اختبار الاتصال والتبديل</Text>}
            </TouchableOpacity>
          </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

function SettingRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: colors.warmGray, true: colors.gold }} thumbColor={value ? colors.primary : colors.background} />
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

function SoundChoice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <TouchableOpacity style={[styles.soundChoice, active && styles.soundChoiceActive]} onPress={onPress}><Text style={[styles.soundChoiceText, active && styles.soundChoiceTextActive]}>{label}</Text></TouchableOpacity>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  section: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: colors.line, ...shadow },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontFamily: 'TajawalBold', fontSize: 18, fontWeight: '900', color: colors.primary, marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  label: { fontFamily: 'TajawalRegular', fontSize: 16, color: colors.ink, flex: 1, textAlign: 'right' },
  hint: { fontFamily: 'TajawalRegular', fontSize: 13, color: colors.muted, marginTop: 8, lineHeight: 19, textAlign: 'right' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.line },
  infoLabel: { fontFamily: 'TajawalRegular', fontSize: 14, color: colors.muted },
  infoValue: { fontFamily: 'TajawalBold', flex: 1, fontSize: 14, color: colors.ink, fontWeight: '700', textAlign: 'left' },
  danger: { color: '#B42318' },
  errorText: { color: '#B42318', backgroundColor: '#FEF3F2', padding: 10, borderRadius: 8, marginTop: 10, textAlign: 'right' },
  diagnosticsBox: { backgroundColor: '#FFF8E8', borderRadius: radius.sm, padding: 10, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  diagnosticsTitle: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 15, fontWeight: '900', textAlign: 'right', marginBottom: 6 },
  diagnosticItem: { borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: 8 },
  diagnosticHeading: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 13, fontWeight: '900', textAlign: 'left' },
  diagnosticError: { fontFamily: 'TajawalRegular', color: '#B42318', fontSize: 13, marginTop: 3, textAlign: 'left' },
  diagnosticPayload: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, marginTop: 3, textAlign: 'left' },
  discardBtn: { backgroundColor: '#FEF3F2', borderRadius: radius.sm, padding: 12, alignItems: 'center', marginTop: 10 },
  discardBtnText: { fontFamily: 'TajawalBold', color: '#B42318', fontSize: 14, fontWeight: '900' },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  badgeOk: { backgroundColor: '#DDF7EC' },
  badgeWarn: { backgroundColor: '#FFF1D6' },
  badgeText: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 13, fontWeight: '800' },
  primaryBtn: { backgroundColor: colors.gold, borderRadius: radius.md, padding: 14, alignItems: 'center', marginTop: 14 },
  primaryBtnText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 16, fontWeight: '900' },
  disabledBtn: { opacity: 0.65 },
  outlineBtn: { borderColor: colors.goldDark, borderWidth: 1, borderRadius: radius.md, padding: 12, alignItems: 'center', marginTop: 10 },
  outlineBtnText: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.primary, fontWeight: '900' },
  logoutBtn: { padding: 14, alignItems: 'center', backgroundColor: '#FEF3F2', borderRadius: 10, marginTop: 16 },
  logoutText: { fontFamily: 'TajawalBold', color: '#B42318', fontSize: 16, fontWeight: '700' },
  modalShade: { flex: 1, backgroundColor: 'rgba(0,40,34,.7)' },
  modalScroll: { flexGrow: 1, justifyContent: 'center', padding: 18 },
  modalCard: { backgroundColor: colors.surface, padding: 18, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.goldDark, ...shadow },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 20, fontWeight: '900' },
  modalClose: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.goldDark, fontWeight: '900' },
  fieldLabel: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 14, fontWeight: '800', textAlign: 'right', marginTop: 8, marginBottom: 5 },
  input: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.background, borderRadius: radius.sm, paddingHorizontal: 12, height: 48, color: colors.ink },
  soundChoices: { flexDirection: 'row-reverse', gap: 6, marginTop: 3 },
  soundChoice: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, alignItems: 'center' },
  soundChoiceActive: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  soundChoiceText: { fontFamily: 'TajawalBold', color: colors.muted, fontSize: 13, fontWeight: '700' },
  soundChoiceTextActive: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.primary, fontWeight: '900' },
  updateBox: { marginTop: 10, borderRadius: radius.sm, backgroundColor: '#F1F8F5', borderWidth: 1, borderColor: colors.line, padding: 12 },
  updateTitle: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 16, fontWeight: '900', textAlign: 'right' },
  downloadProgressBox: { marginTop: 10 },
  downloadProgressTrack: { height: 10, borderRadius: 999, overflow: 'hidden', backgroundColor: '#DCE7E3' },
  downloadProgressFill: { height: '100%', borderRadius: 999, backgroundColor: colors.primary },
  downloadProgressText: { fontFamily: 'TajawalBold', marginTop: 6, color: colors.primary, fontSize: 13, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] },
});
