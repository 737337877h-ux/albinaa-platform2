import React from 'react';
import { FlatList, Modal, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { matchesSmartSearch } from '../utils/search';

export type RequestPickerOption = { key: string; label: string; hint?: string; raw?: unknown };

export default function RequestSearchPicker({ label, value, options, placeholder = 'اختر', onSelect, onSearchChange, loading, error, onBarcodePress }:{
  label: string; value?: RequestPickerOption; options: RequestPickerOption[]; placeholder?: string;
  onSelect: (option: RequestPickerOption) => void; onSearchChange?: (value: string) => void; loading?: boolean; error?: string;
  onBarcodePress?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const visible = search.trim() ? options.filter((option) => matchesSmartSearch(`${option.label} ${option.hint ?? ''}`, search)) : options;
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.selectRow}>
      {onBarcodePress ? <TouchableOpacity accessibilityLabel="قراءة باركود الصنف" style={styles.scan} onPress={onBarcodePress}><Ionicons name="barcode-outline" size={25} color="#fff" /></TouchableOpacity> : null}
      <TouchableOpacity style={styles.select} onPress={() => setOpen(true)}>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
        <View style={styles.selectText}><Text numberOfLines={2} style={[styles.value, !value && styles.placeholder]}>{value?.label ?? (loading ? 'جار التحميل…' : placeholder)}</Text>{value?.hint ? <Text style={styles.hint}>{value.hint}</Text> : null}</View>
      </TouchableOpacity>
    </View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={styles.modal}>
        <View style={styles.modalHeader}><TouchableOpacity onPress={() => setOpen(false)}><Text style={styles.close}>إغلاق</Text></TouchableOpacity><Text style={styles.modalTitle}>{label}</Text></View>
        <View style={styles.searchWrap}><Ionicons name="search" size={19} color={colors.muted} /><TextInput value={search} onChangeText={(value) => { setSearch(value); onSearchChange?.(value); }} style={styles.search} placeholder="ابحث بالرقم أو الاسم…" placeholderTextColor={colors.muted} textAlign="right" autoFocus /></View>
        <FlatList keyboardShouldPersistTaps="handled" data={visible} keyExtractor={(item) => item.key}
          ListEmptyComponent={<Text style={styles.empty}>لا توجد نتائج مطابقة.</Text>}
          renderItem={({ item }) => <TouchableOpacity style={styles.option} onPress={() => { onSelect(item); setSearch(''); setOpen(false); }}>
            <Text style={styles.optionLabel}>{item.label}</Text>{item.hint ? <Text style={styles.optionHint}>{item.hint}</Text> : null}
          </TouchableOpacity>} />
      </SafeAreaView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  field: { marginBottom: 11 }, label: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.ink, fontWeight: '900', textAlign: 'right', marginBottom: 6 },
  selectRow:{flexDirection:'row',alignItems:'stretch',gap:8},
  select: { flex:1,minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 12 },
  scan:{width:54,borderRadius:radius.sm,backgroundColor:colors.primary,alignItems:'center',justifyContent:'center'},
  selectText: { flex: 1 }, value: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.ink, textAlign: 'right', fontWeight: '800' }, placeholder: { fontFamily: 'TajawalMedium', fontSize: 15, color: colors.muted, fontWeight: '600' }, hint: { fontFamily: 'TajawalRegular', color: colors.muted, textAlign: 'right', fontSize: 13, marginTop: 2 }, error: { color: colors.danger, textAlign: 'right', marginTop: 5 },
  modal: { flex: 1, backgroundColor: colors.background, padding: 14 }, modalHeader: { minHeight: 54, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, modalTitle: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 20, fontWeight: '900' }, close: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.primary, fontWeight: '900' },
  searchWrap: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 12, marginBottom: 10 }, search: { flex: 1, color: colors.ink },
  option: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line, padding: 13 }, optionLabel: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.ink, textAlign: 'right', fontWeight: '900' }, optionHint: { fontFamily: 'TajawalRegular', color: colors.muted, textAlign: 'right', fontSize: 13, marginTop: 3 }, empty: { color: colors.muted, textAlign: 'center', padding: 24 },
});
