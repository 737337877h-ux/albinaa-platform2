import React from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { fetchInventoryItem } from '../api/endpoints';
import { colors, radius } from '../theme';
import RequestBarcodeScanner from '../components/request-barcode-scanner';
import { apiErrorMessage } from '../utils/errors';
import {useAuth} from '../store/auth-context';
import {inventoryCostAccess} from '../utils/inventory-cost-access';

export default function InventoryItemScreen({ route, navigation }: any) {
  const permissions=useAuth().user?.permissions??[];
  const canCost=permissions.includes('mobile.inventory.cost.view');
  const code = String(route.params?.code || '');
  const [scannerVisible, setScannerVisible] = React.useState(false);
  const query = useQuery({ queryKey: ['mobile-inventory-item', code], queryFn: async () => (await fetchInventoryItem(code)).data, enabled: !!code });
  if (query.isLoading) return <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />;
  if (!query.data) return <View style={styles.center}><Text style={styles.empty}>تعذر تحميل الصنف</Text></View>;
  const item = inventoryCostAccess(query.data,permissions);
  const totalAvailable = (item.stockRows ?? []).reduce((total: number, row: any) =>
    total + Number(row.availableQuantity || 0) * Number(row.packageSize || 1), 0);
  const activity = item.activity ?? {};
  const pricing = item.pricing ?? {};
  const priceList = (rows: any[] | undefined, fallback: unknown) => Array.isArray(rows) && rows.length
    ? rows.map((row) => `${Number(row.price).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${row.currencyCode}${row.unitName ? ` / ${row.unitName}` : ''}`).join(' · ')
    : fallback;
  const openBarcode = async (value: string) => {
    setScannerVisible(false);
    try {
      const next = (await fetchInventoryItem(value)).data;
      const nextCode = String(next?.externalItemCode || '').trim();
      if (!nextCode) return Alert.alert('باركود غير معروف', 'لم يُعثر على الصنف في دليل المخزون.');
      navigation.replace('InventoryItem', { code: nextCode });
    } catch (error) {
      Alert.alert('تعذر فتح الصنف', apiErrorMessage(error, 'لم يُعثر على الباركود في دليل المخزون.'));
    }
  };
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <View style={styles.head}>
      <TouchableOpacity accessibilityLabel="مسح باركود صنف آخر" style={styles.scanAction} onPress={() => setScannerVisible(true)}><Ionicons name="barcode-outline" size={24} color={colors.primary} /><Text style={styles.scanActionText}>مسح صنف آخر</Text></TouchableOpacity>
      <View style={styles.headLine}>
        <View style={[styles.statusBadge, activity.status === 'demanded' ? styles.statusDemanded : activity.status === 'moving' ? styles.statusMoving : styles.statusStagnant]}>
          <Text style={styles.statusText}>{activity.labelAr || 'غير مصنف'}</Text>
        </View>
        <View style={{ flex: 1 }}><Text style={styles.formName}>بيانات الأصناف INVI008</Text><Text style={styles.name}>{item.nameAr}</Text><Text style={styles.code}>{item.externalItemCode}</Text><Text style={styles.group}>{item.group?.nameAr || ''}</Text></View>
      </View>
    </View>
    <View style={styles.metrics}>
      <Metric label="الكمية المتوفرة" value={totalAvailable} />
      <Metric label="الكمية الواردة" value={activity.inboundPrimaryQuantity ?? 0} />
      <Metric label="الكمية المنصرفة" value={activity.outboundPrimaryQuantity ?? 0} />
      {canCost&&<Metric label="متوسط التكلفة" value={pricing.weightedAverageCost} empty="—" />}
      {canCost&&<TextMetric label="آخر سعر توريد" value={priceList(pricing.lastSupplyPrices, pricing.lastSupplyCost)} empty="—" />}
      <TextMetric label="آخر سعر بيع" value={priceList(pricing.lastSalePrices, pricing.lastSalePrice)} empty="غير متاح" />
      <TextMetric label="متوسط سعر البيع" value={priceList(pricing.averageSalePrices, pricing.averageSalePrice)} empty="غير متاح" />
      <TextMetric label="سعر البيع الافتراضي" value={pricing.salePrice == null ? null : `${Number(pricing.salePrice).toLocaleString('en-US')} ${pricing.salePriceUnit ? `/ ${pricing.salePriceUnit}` : ''}`} empty="غير متاح" />
    </View>
    {!!pricing.noteAr && <Text style={styles.notice}>{pricing.noteAr}</Text>}
    <Text style={styles.title}>الرصيد حسب المستودع</Text>
    {(item.stockRows ?? []).map((row: any, index: number) => <View key={`${row.externalWarehouseCode}-${row.unitName}-${index}`} style={styles.row}>
      <View><Text style={styles.qty}>{Number(row.availableQuantity || 0).toLocaleString('en-US')} {row.unitName}</Text>{canCost&&<Text style={styles.cost}>متوسط التكلفة: {row.weightedAverageCost == null ? '—' : Number(row.weightedAverageCost).toLocaleString('en-US')}</Text>}</View>
      <View style={{ flex: 1 }}><Text style={styles.warehouse}>{row.warehouse?.nameAr || row.externalWarehouseCode}</Text><Text style={styles.code}>{row.externalWarehouseCode}</Text></View>
    </View>)}
    <Text style={styles.title}>أحدث حركات Oracle — قراءة فقط</Text>
    {(item.movements ?? []).slice(0, 30).map((movement: any) => <View key={movement.documentSequence} style={styles.row}>
      <Text style={[styles.qty, { color: movement.inOut === 1 ? colors.success : colors.danger }]}>{movement.inOut === 1 ? 'وارد' : 'صادر'} {Number(movement.itemQuantity || 0).toLocaleString('en-US')}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.warehouse}>{movement.documentTypeLabelAr || `مستند نوع ${movement.documentType}`} — {movement.documentNumber}</Text>
        <Text style={styles.customer}>{movement.customer?.name || (movement.externalCustomerCode ? `عميل رقم ${movement.externalCustomerCode}` : 'غير مرتبط بعميل')}</Text>
        <Text style={styles.cost}>{new Date(movement.movementDate).toLocaleDateString('ar-YE')}{movement.itemCost == null ? '' : ` · ${Number(movement.itemCost).toLocaleString('en-US')} ${movement.currencyCode || ''}`}</Text>
      </View>
    </View>)}
    <RequestBarcodeScanner visible={scannerVisible} onClose={() => setScannerVisible(false)} onScanned={openBarcode} />
  </ScrollView>;
}

function Metric({ label, value, empty = '0' }: { label: string; value: unknown; empty?: string }) {
  const number = Number(value);
  const shown = value === null || value === undefined || value === '' || !Number.isFinite(number)
    ? empty : number.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return <View style={styles.metric}><Text style={styles.metricValue}>{shown}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function TextMetric({ label, value, empty = '—' }: { label: string; value: unknown; empty?: string }) {
  const shown = value === null || value === undefined || value === '' ? empty : String(value);
  return <View style={styles.metric}><Text style={styles.metricValue}>{shown}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, content: { padding: 14, paddingBottom: 80 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, empty: { color: colors.muted },
  head: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: 18 }, headLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, formName: { fontFamily: 'TajawalBold', color: colors.gold, fontSize: 13, fontWeight: '800', textAlign: 'right', marginBottom: 3 }, name: { fontFamily: 'TajawalBold', color: '#fff', fontSize: 21, fontWeight: '900', textAlign: 'right' }, code: { fontFamily: 'TajawalRegular', color: colors.gold, fontSize: 13, marginTop: 4, textAlign: 'right' }, group: { fontFamily: 'TajawalRegular', color: '#C6D9D4', fontSize: 13, marginTop: 5, textAlign: 'right' },
  scanAction:{alignSelf:'flex-start',minHeight:42,flexDirection:'row-reverse',alignItems:'center',gap:7,backgroundColor:colors.gold,borderRadius:radius.sm,paddingHorizontal:12,marginBottom:12},scanActionText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.primary,fontWeight:'900'},
  statusBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }, statusDemanded: { backgroundColor: colors.gold }, statusMoving: { backgroundColor: colors.success }, statusStagnant: { backgroundColor: colors.danger }, statusText: { fontFamily: 'TajawalBold', color: '#fff', fontSize: 13, fontWeight: '900' },
  metrics: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 10 }, metric: { width: '48%', minHeight: 72, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 10, justifyContent: 'center' }, metricValue: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 16, fontWeight: '900', textAlign: 'right' }, metricLabel: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, marginTop: 4, textAlign: 'right' }, notice: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, textAlign: 'right', backgroundColor: colors.goldSoft, borderRadius: radius.md, padding: 10, marginTop: 8 },
  title: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 18, fontWeight: '900', textAlign: 'right', marginTop: 20, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, marginBottom: 8 },
  warehouse: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.ink, fontWeight: '800', textAlign: 'right' }, customer: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 13, fontWeight: '800', marginTop: 3, textAlign: 'right' }, qty: { fontFamily: 'TajawalBold', color: colors.primary, fontWeight: '900', fontSize: 14 }, cost: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, marginTop: 4, textAlign: 'right' },
});
