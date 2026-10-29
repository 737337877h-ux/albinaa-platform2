import React from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { fetchInventoryItem, fetchInventoryItems, fetchInventorySummary } from '../api/endpoints';
import RequestBarcodeScanner from '../components/request-barcode-scanner';
import { apiErrorMessage } from '../utils/errors';
import { colors, radius, shadow } from '../theme';
import { useSync } from '../store/sync-context';
import {useAuth} from '../store/auth-context';

export default function InventoryScreen({ navigation }: any) {
  const canCost=useAuth().user?.permissions.includes('mobile.inventory.cost.view');
  const [search, setSearch] = React.useState('');
  const [submitted, setSubmitted] = React.useState('');
  const [manualRefreshing, setManualRefreshing] = React.useState(false);
  const [scannerVisible, setScannerVisible] = React.useState(false);
  const [resolvingBarcode, setResolvingBarcode] = React.useState(false);
  const { triggerSync, status } = useSync();
  const summary = useQuery({ queryKey: ['mobile-inventory-summary'], queryFn: async () => (await fetchInventorySummary()).data });
  const items = useQuery({ queryKey: ['mobile-inventory-items', submitted], queryFn: async () => (await fetchInventoryItems(submitted)).data });
  const refreshing = manualRefreshing || summary.isFetching || items.isFetching;
  const refresh = async () => {
    setManualRefreshing(true);
    try {
      await triggerSync();
      await Promise.all([summary.refetch(), items.refetch()]);
    } finally {
      setManualRefreshing(false);
    }
  };
  const openBarcode = async (value: string) => {
    setScannerVisible(false);
    setResolvingBarcode(true);
    try {
      const item = (await fetchInventoryItem(value)).data;
      const code = String(item?.externalItemCode || '').trim();
      if (!code) return Alert.alert('باركود غير معروف', 'لم يُعثر على الصنف في دليل المخزون المحلي أو المنشور.');
      navigation.navigate('InventoryItem', { code });
    } catch (error) {
      Alert.alert('تعذر فتح الصنف', apiErrorMessage(error, 'لم يُعثر على الباركود في دليل المخزون.'));
    } finally {
      setResolvingBarcode(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.searchRow}>
        <TouchableOpacity accessibilityLabel="مسح باركود الصنف" style={styles.scanButton} onPress={() => setScannerVisible(true)}><Ionicons name="barcode-outline" size={24} color="#fff" /></TouchableOpacity>
        <TouchableOpacity style={styles.searchButton} onPress={() => setSubmitted(search.trim())}><Ionicons name="search" size={20} color="#fff" /></TouchableOpacity>
        <TextInput value={search} onChangeText={setSearch} onSubmitEditing={() => setSubmitted(search.trim())}
          placeholder="اسم الصنف أو الكود أو الباركود" placeholderTextColor={colors.muted} style={styles.input} textAlign="right" returnKeyType="search" />
      </View>
      {!!summary.data && <View style={styles.summaryRow}>
        <Summary label="الأصناف" value={summary.data.counts?.items ?? 0} />
        <Summary label="المستودعات" value={summary.data.counts?.warehouses ?? 0} />
        {canCost&&<Summary label={`قيمة المخزون (${summary.data.valuation?.currencyCode ?? 'SAR'})`} value={summary.data.valuation?.totalInventoryCost ?? 0} compact />}
      </View>}
      <Text style={styles.cacheNote}>
        {status.phase === 'offline' ? 'يُعرض آخر مخزون محفوظ على الهاتف — بدون اتصال' : 'المخزون محفوظ محليًا ويتحدث عند المزامنة'}
      </Text>
      {!!summary.data?.reservationStock && <View style={styles.tonPanel}>
        <Text style={styles.tonTitle}>المخزون والحجوزات بالطن</Text>
        <View style={styles.summaryRowInner}>
          <Summary label="الإجمالي" value={summary.data.reservationStock.grossTons ?? 0} />
          <Summary label="المحجوز" value={summary.data.reservationStock.reservedTons ?? 0} />
          <Summary label="صافي المتاح" value={summary.data.reservationStock.netAvailableTons ?? 0} />
        </View>
      </View>}
      {items.isLoading ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : (
        <FlatList data={items.data?.items ?? []} keyExtractor={(item: any) => item.externalItemCode}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>{submitted ? 'لا توجد أصناف مطابقة' : 'اسحب للأسفل لتنزيل دليل الأصناف والمخزون إلى الهاتف'}</Text>}
          renderItem={({ item }: any) => <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('InventoryItem', { code: item.externalItemCode })}>
            <Ionicons name="chevron-back" size={18} color={colors.muted} />
            <View style={styles.cardMain}><Text style={styles.name}>{item.nameAr}</Text><Text style={styles.meta}>{item.externalItemCode} · {item.group?.nameAr || 'بدون مجموعة'}</Text></View>
            <View style={styles.unitBadge}><Text style={styles.unitCount}>{item._count?.units ?? 0}</Text><Text style={styles.unitLabel}>وحدة</Text></View>
          </TouchableOpacity>}
        />
      )}
      {resolvingBarcode ? <View style={styles.resolving}><ActivityIndicator color="#fff" /><Text style={styles.resolvingText}>جارٍ فتح بيانات الصنف…</Text></View> : null}
      <RequestBarcodeScanner visible={scannerVisible} onClose={() => setScannerVisible(false)} onScanned={openBarcode} />
    </View>
  );
}

function Summary({ label, value, compact }: { label: string; value: number | string; compact?: boolean }) {
  const number = Number(value || 0);
  return <View style={styles.summary}><Text style={[styles.summaryValue, compact && styles.summaryValueCompact]}>{number.toLocaleString('en-US', { maximumFractionDigits: compact ? 0 : 2 })}</Text><Text style={styles.summaryLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  searchRow: { flexDirection: 'row', gap: 8, padding: 14 },
  input: { flex: 1, minHeight: 48, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14, color: colors.ink },
  searchButton: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  scanButton: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.goldDark, alignItems: 'center', justifyContent: 'center' },
  summaryRow: { flexDirection: 'row-reverse', gap: 7, paddingHorizontal: 14, paddingBottom: 10 },
  tonPanel: { marginHorizontal: 14, marginBottom: 10, backgroundColor: colors.primarySoft, borderRadius: radius.md, paddingTop: 10 },
  tonTitle: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.primary, fontWeight: '900', textAlign: 'right', paddingHorizontal: 12, marginBottom: 8 },
  summaryRowInner: { flexDirection: 'row-reverse', gap: 7, paddingHorizontal: 8, paddingBottom: 8 },
  summary: { flex: 1, minHeight: 76, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  summaryValue: { fontFamily: 'TajawalBold', color: colors.primary, fontWeight: '900', fontSize: 20 }, summaryValueCompact: { fontFamily: 'TajawalRegular', fontSize: 16 }, summaryLabel: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, marginTop: 3 },
  loader: { marginTop: 60 }, list: { paddingHorizontal: 14, paddingBottom: 90 },
  cacheNote: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, textAlign: 'right', paddingHorizontal: 16, paddingBottom: 8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 13, marginBottom: 9, ...shadow },
  cardMain: { flex: 1 }, name: { fontFamily: 'TajawalBold', color: colors.ink, fontWeight: '900', fontSize: 15, textAlign: 'right' }, meta: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, marginTop: 4, textAlign: 'right' },
  unitBadge: { minWidth: 42, alignItems: 'center', backgroundColor: colors.goldSoft, borderRadius: 11, padding: 7 }, unitCount: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.primary, fontWeight: '900' }, unitLabel: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 60 },
  resolving:{position:'absolute',left:18,right:18,top:76,minHeight:52,borderRadius:radius.md,backgroundColor:colors.primary,flexDirection:'row-reverse',gap:9,alignItems:'center',justifyContent:'center'},resolvingText:{ fontFamily: 'TajawalBold', fontSize: 15,color:'#fff',fontWeight:'900'},
});
