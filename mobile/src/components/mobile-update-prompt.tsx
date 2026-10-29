import React from 'react';
import { ActivityIndicator, Alert, AppState, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '../store/auth-context';
import {
  downloadAndInstallMobileUpdate, fetchAvailableMobileUpdate, showUpdateError,
} from '../utils/mobile-update';

const PROMPTED_KEY = 'albinaa.mobile_update.prompted';

export default function MobileUpdatePrompt() {
  const { isAuthenticated } = useAuth();
  const [downloading, setDownloading] = React.useState(false);
  const [requiredRelease, setRequiredRelease] = React.useState<Awaited<ReturnType<typeof fetchAvailableMobileUpdate>>>(null);
  const [progress, setProgress] = React.useState({ written: 0, total: 0, fraction: 0 });
  const startDownload = React.useCallback(async (release: Awaited<ReturnType<typeof fetchAvailableMobileUpdate>>) => {
    if (!release) return;
    setDownloading(true);
    setProgress({ written: 0, total: release.size, fraction: 0 });
    try {
      await downloadAndInstallMobileUpdate(release, setProgress);
    } catch (error) {
      showUpdateError(error);
    } finally {
      setDownloading(false);
    }
  }, []);
  React.useEffect(() => {
    if (!isAuthenticated) return;
    let alive = true;
    let checking = false;
    let lastCheck = 0;
    const check = async () => {
      if (!alive || checking || downloading || AppState.currentState !== 'active' || Date.now() - lastCheck < 60_000) return;
      checking = true;
      lastCheck = Date.now();
      try {
        const release = await fetchAvailableMobileUpdate();
        if (!alive) return;
        if (!release) { setRequiredRelease(null); return; }
        if (release.mandatory) { setRequiredRelease(release); return; }
        setRequiredRelease(null);
        const prompted = await SecureStore.getItemAsync(PROMPTED_KEY);
        const [version, promptedAt] = (prompted ?? '').split(':');
        if (version === String(release.versionCode) && Date.now() - Number(promptedAt) < 24 * 60 * 60 * 1000) return;
        if (!alive) return;
        await SecureStore.setItemAsync(PROMPTED_KEY, `${release.versionCode}:${Date.now()}`);
        const install = () => { void startDownload(release); };
        Alert.alert(
          release.mandatory ? 'تحديث مطلوب للتطبيق' : 'يتوفر تحديث جديد',
          `الإصدار ${release.versionName}\n${release.notes || 'تحسينات وإصلاحات جديدة.'}`,
          release.mandatory
            ? [{ text: 'تنزيل وتثبيت', onPress: install }]
            : [{ text: 'لاحقًا', style: 'cancel' }, { text: 'تنزيل وتثبيت', onPress: install }],
          { cancelable: !release.mandatory },
        );
      } catch {
        // Offline startup is normal. The next foreground/sync cycle checks again.
      } finally {
        checking = false;
      }
    };
    const timer = setTimeout(() => { void check(); }, 5_000);
    const interval = setInterval(() => { void check(); }, 5 * 60_000);
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => { alive = false; clearTimeout(timer); clearInterval(interval); foreground.remove(); };
  }, [isAuthenticated, startDownload, downloading]);
  const percent = Math.round(progress.fraction * 100);
  const mb = (value: number) => (value / 1024 / 1024).toFixed(1);
  return <Modal visible={isAuthenticated && (downloading || !!requiredRelease)} transparent animationType="fade" onRequestClose={() => {}}>
    <View style={styles.shade}>
      <View style={styles.card}>
        {downloading ? <ActivityIndicator size="large" color="#D4AF37" /> : null}
        <Text style={styles.title}>{downloading ? 'جارٍ تنزيل تحديث التطبيق' : `تحديث إجباري ${requiredRelease?.versionName ?? ''}`}</Text>
        {!downloading && <><Text style={styles.hint}>{requiredRelease?.notes}</Text><Text style={styles.hint}>يلزم تثبيت التحديث للمتابعة. المسودات المحفوظة لا تُحذف. إذا ألغيت التثبيت يمكنك إعادة المحاولة هنا.</Text><TouchableOpacity style={{ padding: 16 }} onPress={() => startDownload(requiredRelease)}><Text style={styles.title}>تنزيل وتثبيت — إعادة المحاولة</Text></TouchableOpacity></>}
        {downloading && <><Text style={styles.percent}>{percent}%</Text>
        <View style={styles.track}><View style={[styles.fill, { width: `${percent}%` }]} /></View>
        <Text style={styles.size}>{mb(progress.written)} من {mb(progress.total)} م.ب</Text>
        <Text style={styles.hint}>اترك التطبيق مفتوحًا حتى يظهر طلب التثبيت من Android.</Text></>}
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  shade: { flex: 1, backgroundColor: 'rgba(0,35,30,.72)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, borderRadius: 20, backgroundColor: '#fff', padding: 22, alignItems: 'center' },
  title: { fontFamily: 'TajawalBold', marginTop: 12, color: '#163D36', fontSize: 18, fontWeight: '900' },
  percent: { fontFamily: 'TajawalBold', marginTop: 8, color: '#006B5B', fontSize: 26, fontWeight: '900' },
  track: { width: '100%', height: 11, marginTop: 10, borderRadius: 999, overflow: 'hidden', backgroundColor: '#E5ECE9' },
  fill: { height: '100%', borderRadius: 999, backgroundColor: '#D4AF37' },
  size: { marginTop: 8, color: '#5E6F6A', fontVariant: ['tabular-nums'] },
  hint: { fontFamily: 'TajawalRegular', marginTop: 10, color: '#70807B', fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
