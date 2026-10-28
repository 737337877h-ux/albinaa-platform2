import React from 'react';
import { Modal, View, Text, Image, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadReceiptImage, receiptErrorMessage } from '../api/receipt-image';

export type ReceiptReference = { id: string; name: string };

export default function ReceiptPreview({ receipt, onClose }: {
  receipt: ReceiptReference | null; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [result, setResult] = React.useState({ id: '', uri: '', error: '' });
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    if (!receipt) { setResult({ id: '', uri: '', error: '' }); return; }
    const id = receipt.id;
    let active = true;
    const controller = new AbortController();
    setResult({ id, uri: '', error: '' });
    loadReceiptImage(id, controller.signal).then(uri => {
      if (active) setResult({ id, uri, error: '' });
    }).catch(error => {
      if (active) setResult({ id, uri: '', error: receiptErrorMessage(error) });
    });
    return () => { active = false; controller.abort(); };
  }, [receipt?.id, attempt]);
  const current = result.id === receipt?.id ? result : { uri: '', error: '' };
  return <Modal visible={!!receipt} animationType="slide" onRequestClose={onClose}>
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.button}><Text style={styles.text}>إغلاق</Text></TouchableOpacity>
        <Text numberOfLines={1} style={[styles.text, styles.title]}>{receipt?.name || 'صورة الإيصال'}</Text>
      </View>
      {current.error ? <View style={styles.center}>
        <Text style={styles.text}>{current.error}</Text>
        <TouchableOpacity style={styles.button} onPress={() => setAttempt(v => v + 1)}><Text style={styles.text}>إعادة المحاولة</Text></TouchableOpacity>
      </View> : current.uri ? <Image source={{ uri: current.uri }} resizeMode="contain" style={styles.image}
        onError={() => setResult(prev => ({ ...prev, uri: '', error: 'تعذر عرض الصورة. أعد المحاولة أو راجع المرفق.' }))} />
        : <View style={styles.center}><ActivityIndicator color="#fff" /><Text style={styles.text}>جارٍ تحميل الإيصال…</Text></View>}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b1715' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#005247' },
  title: { flex: 1, textAlign: 'right' },
  button: { padding: 14 },
  text: { fontFamily: 'TajawalRegular', color: '#fff', fontSize: 16, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 },
  image: { flex: 1, width: '100%' },
});
