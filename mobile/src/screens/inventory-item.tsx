import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchInventoryItem } from '../api/endpoints';
import { colors, radius } from '../theme';

export default function InventoryItemScreen({ route }: any) {
  const code = String(route.params?.code || '');
  const query = useQuery({ queryKey: ['mobile-inventory-item', code], queryFn: async () => (await fetchInventoryItem(code)).data, enabled: !!code });
  if (query.isLoading) return <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />;
  if (!query.data) return <View style={styles.center}><Text style={styles.empty}>تعذر تحميل الصنف</Text></View>;
  const item = query.data;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <View style={styles.head}><Text style={styles.name}>{item.nameAr}</Text><Text style={styles.code}>{item.externalItemCode}</Text><Text style={styles.group}>{item.group?.nameAr || ''}</Text></View>
    <Text style={styles.title}>الرصيد حسب المستودع</Text>
    {(item.stockRows ?? []).map((row: any, index: number) => <View key={`${row.externalWarehouseCode}-${row.unitName}-${index}`} style={styles.row}>
      <View><Text style={styles.qty}>{Number(row.availableQuantity || 0).toLocaleString('en-US')} {row.unitName}</Text><Text style={styles.cost}>متوسط التكلفة: {row.weightedAverageCost == null ? '—' : Number(row.weightedAverageCost).toLocaleString('en-US')}</Text></View>
      <View style={{ flex: 1 }}><Text style={styles.warehouse}>{row.warehouse?.nameAr || row.externalWarehouseCode}</Text><Text style={styles.code}>{row.externalWarehouseCode}</Text></View>
    </View>)}
    <Text style={styles.title}>آخر الحركات المنشورة</Text>
    {(item.movements ?? []).slice(0, 30).map((movement: any) => <View key={movement.documentSequence} style={styles.row}>
      <Text style={[styles.qty, { color: movement.inOut === 1 ? colors.success : colors.danger }]}>{movement.inOut === 1 ? 'وارد' : 'صادر'} {Number(movement.itemQuantity || 0).toLocaleString('en-US')}</Text>
      <View style={{ flex: 1 }}><Text style={styles.warehouse}>{movement.documentType}/{movement.documentNumber}</Text><Text style={styles.cost}>{new Date(movement.movementDate).toLocaleDateString('ar-YE')}</Text></View>
    </View>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, content: { padding: 14, paddingBottom: 80 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, empty: { color: colors.muted },
  head: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: 18 }, name: { color: '#fff', fontSize: 21, fontWeight: '900', textAlign: 'right' }, code: { color: colors.gold, fontSize: 11, marginTop: 4, textAlign: 'right' }, group: { color: '#C6D9D4', fontSize: 12, marginTop: 5, textAlign: 'right' },
  title: { color: colors.ink, fontSize: 17, fontWeight: '900', textAlign: 'right', marginTop: 20, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, marginBottom: 8 },
  warehouse: { color: colors.ink, fontWeight: '800', textAlign: 'right' }, qty: { color: colors.primary, fontWeight: '900', fontSize: 13 }, cost: { color: colors.muted, fontSize: 10, marginTop: 4, textAlign: 'right' },
});
