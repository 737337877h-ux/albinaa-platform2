import React from 'react';
import {
  ActivityIndicator, Alert, KeyboardTypeOptions, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import {
  createInventoryCount, dryRunInventoryCount, InventoryCountDraftPayload,
} from '../api/endpoints';
import { apiErrorMessage } from '../utils/errors';
import { colors, radius, shadow } from '../theme';

type DraftLine = {
  id: string;
  itemCode: string;
  unitCode: string;
  countedQuantity: string;
};

const newLine = (): DraftLine => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  itemCode: '', unitCode: 'حبة', countedQuantity: '',
});

const newReference = () => `mobile-inventory-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export default function NewInventoryCountScreen({ navigation }: any) {
  const [description, setDescription] = React.useState('جرد من تطبيق البناء الراقي');
  const [warehouseCode, setWarehouseCode] = React.useState('1');
  const [lines, setLines] = React.useState<DraftLine[]>([newLine()]);
  const [externalReference, setExternalReference] = React.useState(newReference);
  const [preview, setPreview] = React.useState<any>(null);

  const payload = React.useCallback((): InventoryCountDraftPayload => ({
    inventoryType: 2,
    warehouseCode: warehouseCode.trim(),
    description: description.trim(),
    externalReference,
    lines: lines.map((line) => ({
      itemCode: line.itemCode.trim(),
      unitCode: line.unitCode.trim(),
      countedQuantity: Number(line.countedQuantity),
    })),
  }), [description, externalReference, lines, warehouseCode]);

  const validate = () => {
    const missing = lines.some((line) => !line.itemCode.trim() || !line.unitCode.trim()
      || line.countedQuantity.trim() === '' || Number(line.countedQuantity) < 0);
    if (!description.trim() || !warehouseCode.trim() || missing) {
      Alert.alert('بيانات ناقصة', 'أكمل البيان والمخزن الافتراضي وكود الصنف والوحدة والكمية لكل سطر.');
      return false;
    }
    return true;
  };

  const dryRun = useMutation({
    mutationFn: async () => (await dryRunInventoryCount(payload())).data,
    onSuccess: (data) => setPreview(data),
    onError: (error) => Alert.alert('تعذر التحقق', apiErrorMessage(error, 'راجع البيانات والاتصال بالخادم')),
  });
  const create = useMutation({
    mutationFn: async () => (await createInventoryCount(payload())).data,
    onSuccess: (data) => {
      Alert.alert('تم إنشاء مسودة الجرد', `رقم المستند ${data.documentNo}`, [
        { text: 'حسنًا', onPress: () => navigation.goBack() },
      ]);
      setExternalReference(newReference());
    },
    onError: (error) => Alert.alert('تعذر إنشاء المسودة', apiErrorMessage(error, 'راجع البيانات والاتصال بالخادم')),
  });

  const updateLine = (id: string, field: keyof DraftLine, value: string) => {
    setLines((current) => current.map((line) => line.id === id ? { ...line, [field]: value } : line));
    setPreview(null);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.notice}>
        <Ionicons name="shield-checkmark-outline" size={22} color={colors.success} />
        <Text style={styles.noticeText}>ينشئ التطبيق مسودة جرد نوع «تطبيق» في IAS20191 فقط. لا يعالج الفروقات ولا يرحّل حركة مخزون.</Text>
      </View>
      <Field label="بيان الجرد" value={description} onChangeText={(value) => { setDescription(value); setPreview(null); }} />
      <Field label="المخزن الافتراضي لكل الأصناف" value={warehouseCode} keyboardType="number-pad" onChangeText={(value) => { setWarehouseCode(value); setPreview(null); }} />
      {lines.map((line, index) => (
        <View key={line.id} style={styles.lineCard}>
          <View style={styles.lineHeader}>
            {lines.length > 1 ? <TouchableOpacity onPress={() => { setLines((current) => current.filter((item) => item.id !== line.id)); setPreview(null); }}>
              <Ionicons name="trash-outline" size={21} color={colors.danger} />
            </TouchableOpacity> : <View />}
            <Text style={styles.lineTitle}>الصنف {index + 1}</Text>
          </View>
          <Field label="كود الصنف" value={line.itemCode} onChangeText={(value) => updateLine(line.id, 'itemCode', value)} />
          <View style={styles.row}>
            <View style={styles.column}><Field label="الوحدة" value={line.unitCode} onChangeText={(value) => updateLine(line.id, 'unitCode', value)} /></View>
            <View style={styles.column}><Field label="كمية الجرد" value={line.countedQuantity} keyboardType="decimal-pad" onChangeText={(value) => updateLine(line.id, 'countedQuantity', value)} /></View>
          </View>
          {preview?.lines?.[index] ? <Text style={styles.previewText}>
            {preview.lines[index].itemNameAr || line.itemCode} · المتاح {preview.lines[index].availableQuantity} · الفرق {preview.lines[index].differenceQuantity}
          </Text> : null}
        </View>
      ))}
      <TouchableOpacity style={styles.addButton} onPress={() => { setLines((current) => [...current, newLine()]); setPreview(null); }}>
        <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
        <Text style={styles.addText}>إضافة صنف</Text>
      </TouchableOpacity>
      {preview?.valid ? <View style={styles.valid}><Text style={styles.validText}>Dry Run صالح — لم تُجرَ أي كتابة في Oracle</Text></View> : null}
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.primaryButton, (!preview?.valid || create.isPending) && styles.disabled]}
          disabled={!preview?.valid || create.isPending} onPress={() => create.mutate()}>
          {create.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>إنشاء مسودة الجرد</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} disabled={dryRun.isPending} onPress={() => validate() && dryRun.mutate()}>
          {dryRun.isPending ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.secondaryText}>Dry Run</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function Field({ label, value, onChangeText, keyboardType }: {
  label: string; value: string; onChangeText: (value: string) => void; keyboardType?: KeyboardTypeOptions;
}) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput
    style={styles.input} value={value} onChangeText={onChangeText} keyboardType={keyboardType}
    textAlign="right" placeholderTextColor={colors.muted}
  /></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 14, paddingBottom: 48 },
  notice: { flexDirection: 'row-reverse', gap: 10, backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 13, marginBottom: 12 },
  noticeText: { flex: 1, color: colors.ink, textAlign: 'right', lineHeight: 21, fontWeight: '700' },
  field: { marginBottom: 11 }, label: { color: colors.ink, fontWeight: '800', textAlign: 'right', marginBottom: 5 },
  input: { minHeight: 48, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 12, color: colors.ink },
  lineCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, marginBottom: 11, ...shadow },
  lineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  lineTitle: { color: colors.primary, fontSize: 16, fontWeight: '900' },
  row: { flexDirection: 'row-reverse', gap: 8 }, column: { flex: 1 },
  previewText: { backgroundColor: colors.primarySoft, color: colors.success, borderRadius: radius.sm, padding: 10, textAlign: 'right', fontWeight: '700' },
  addButton: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 46, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, marginBottom: 12 },
  addText: { color: colors.primary, fontWeight: '900' },
  valid: { backgroundColor: colors.primarySoft, borderRadius: radius.sm, padding: 11, marginBottom: 12 }, validText: { color: colors.success, textAlign: 'right', fontWeight: '800' },
  actions: { flexDirection: 'row-reverse', gap: 9 },
  primaryButton: { flex: 2, minHeight: 50, borderRadius: radius.sm, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '900' }, disabled: { opacity: 0.45 },
  secondaryButton: { flex: 1, minHeight: 50, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.primary, fontWeight: '900' },
});
