import React from 'react';
import { Alert, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors, radius } from '../theme';
import { DEFAULT_MESSAGE_TEMPLATES, loadMessageTemplates, MessageTemplate, saveMessageTemplates } from '../utils/message-templates';

export default function MessageTemplatesScreen() {
  const [templates, setTemplates] = React.useState<MessageTemplate[]>([]);
  const [editing, setEditing] = React.useState<MessageTemplate | null>(null);
  React.useEffect(() => { loadMessageTemplates().then(setTemplates); }, []);

  const save = async () => {
    if (!editing?.name.trim() || !editing.body.trim()) return;
    const next = templates.map((item) => item.id === editing.id ? editing : item);
    await saveMessageTemplates(next);
    setTemplates(next);
    setEditing(null);
    Alert.alert('تم الحفظ', 'أصبح القالب جاهزًا للواتساب والرسائل النصية.');
  };

  const restore = async () => {
    await saveMessageTemplates(DEFAULT_MESSAGE_TEMPLATES);
    setTemplates(DEFAULT_MESSAGE_TEMPLATES);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.hero}><Text style={styles.title}>قوالب الرسائل</Text><Text style={styles.subtitle}>قوالب محلية قابلة للتعديل وتعمل دون اتصال</Text></View>
      <FlatList data={templates} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} renderItem={({ item }) => (
        <TouchableOpacity style={styles.card} onPress={() => setEditing({ ...item })}>
          <View style={styles.row}><Text style={styles.channel}>{item.channel === 'both' ? 'واتساب + SMS' : item.channel}</Text><Text style={styles.name}>{item.name}</Text></View>
          <Text style={styles.body} numberOfLines={3}>{item.body}</Text>
        </TouchableOpacity>
      )} />
      <TouchableOpacity style={styles.restore} onPress={restore}><Text style={styles.restoreText}>استعادة القوالب الافتراضية</Text></TouchableOpacity>
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={styles.shade}><View style={styles.editor}>
          <Text style={styles.editorTitle}>تعديل القالب</Text>
          <TextInput style={styles.input} value={editing?.name || ''} onChangeText={(name) => setEditing((old) => old && ({ ...old, name }))} textAlign="right" />
          <TextInput style={[styles.input, styles.multiline]} multiline value={editing?.body || ''} onChangeText={(body) => setEditing((old) => old && ({ ...old, body }))} textAlign="right" />
          <Text style={styles.hint}>المتغيرات المتاحة: {'{customerName}'} {'{customerCode}'} {'{balance}'} {'{currency}'}</Text>
          <View style={styles.actions}><TouchableOpacity style={styles.cancel} onPress={() => setEditing(null)}><Text>إلغاء</Text></TouchableOpacity><TouchableOpacity style={styles.save} onPress={save}><Text style={styles.saveText}>حفظ</Text></TouchableOpacity></View>
        </View></View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, hero: { backgroundColor: colors.primary, padding: 20 },
  title: { fontFamily: 'TajawalBold', color: '#fff', fontSize: 23, fontWeight: '900', textAlign: 'right' }, subtitle: { fontFamily: 'TajawalRegular', color: '#B9CCC7', fontSize: 13, marginTop: 4, textAlign: 'right' }, list: { padding: 14, paddingBottom: 90 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, marginBottom: 9 }, row: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 16, fontWeight: '900' }, channel: { fontFamily: 'TajawalBold', color: colors.warning, backgroundColor: colors.goldSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4, fontSize: 13, fontWeight: '800' }, body: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 9, textAlign: 'right' },
  restore: { position: 'absolute', bottom: 18, alignSelf: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 11 }, restoreText: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.primary, fontWeight: '800' },
  shade: { flex: 1, backgroundColor: 'rgba(5,28,25,.55)', justifyContent: 'flex-end' }, editor: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 30 }, editorTitle: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 20, fontWeight: '900', textAlign: 'right', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: colors.line, backgroundColor: '#F8FAF9', borderRadius: radius.sm, padding: 12, color: colors.ink, marginBottom: 9, textAlign: 'right' }, multiline: { minHeight: 150, textAlignVertical: 'top' }, hint: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, textAlign: 'right' }, actions: { flexDirection: 'row-reverse', gap: 8, marginTop: 14 }, cancel: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, alignItems: 'center', padding: 13 }, save: { flex: 2, backgroundColor: colors.gold, borderRadius: radius.sm, alignItems: 'center', padding: 13 }, saveText: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.primary, fontWeight: '900' },
});
