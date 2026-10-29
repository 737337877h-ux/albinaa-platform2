import React, { useState } from 'react';
import { View, Text, SectionList, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getAll } from '../db/database';
import { colors, radius, shadow } from '../theme';
import { useAuth } from '../store/auth-context';
import { canUseMobileFeature } from '../utils/mobile-permissions';
import { useSync } from '../store/sync-context';
import { parseJsonField } from '../utils/errors';
import ReceiptPreview, { ReceiptReference } from '../components/receipt-preview';
import { collectionBucket, collectionSourceLabel, collectionStatusLabel, collectionSummary } from '../utils/collections';
import { isLocalToday, localDateKey } from '../utils/local-date';

export default function CollectionsListScreen({ navigation }: any) {
  const { user } = useAuth();
  const { status } = useSync();
  const canCreate = canUseMobileFeature(user?.permissions, 'mobile.collections.create', 'collections.create');
  const canViewReceipts = canUseMobileFeature(user?.permissions, 'mobile.receipts.view', 'collections.create')
    || (user?.permissions ?? []).some((code) => ['collections.approve', 'cash.receive', 'finance.alerts.receive', 'settings.manage'].includes(code));
  const [localCollections, setLocalCollections] = useState<any[]>([]);
  const [receiptPreview, setReceiptPreview] = useState<ReceiptReference | null>(null);

  const previewReceipt = async (item: any) => {
    const attachment = parseJsonField<any>(item.receiptAttachment, item.receiptAttachment || null);
    if (!attachment?.id) return;
    setReceiptPreview({ id: String(attachment.id), name: attachment.fileName || 'إيصال التحصيل' });
  };

  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        setLocalCollections(await getAll('collections'));
      })();
    }, []),
  );

  React.useEffect(() => {
    if (status.phase === 'synced' && status.lastSyncAt) {
      getAll('collections').then(setLocalCollections).catch(() => undefined);
    }
  }, [status.lastSyncAt, status.phase]);

  const seen = new Set<string>();
  const all: any[] = [];
  for (const c of localCollections) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    all.push(c);
  }
  all.sort((a, b) => (b.collectedAt || b.updatedAt || '').localeCompare(a.collectedAt || a.updatedAt || ''));

  const today = localDateKey(new Date());
  const todayCollections = all.filter((c) => isLocalToday(c.collectedAt, today));
  const todaySummary = collectionSummary(todayCollections);
  const todayIds = new Set(todayCollections.map((c) => c.id));
  const recentCollections = all.filter((c) => !todayIds.has(c.id)).slice(0, 50);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>التحصيلات</Text>
          <Text style={styles.subtitle}>اليوم: {todayCollections.length.toLocaleString('en-US')} سجل</Text>
        </View>
        {canCreate && <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('NewCollection')}>
          <Text style={styles.addBtnText}>+ تحصيل</Text>
        </TouchableOpacity>}
      </View>

      <SectionList
        sections={[
          ...(todayCollections.length ? [{ title: 'تحصيلات اليوم', data: todayCollections }] : []),
          ...(recentCollections.length ? [{ title: 'التحصيلات السابقة', data: recentCollections }] : []),
        ]}
        keyExtractor={(item) => String(item.id)}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        ListHeaderComponent={<View style={styles.summary}>
          <Text style={styles.summaryTitle}>ملخص اليوم حسب الحالة والعملة</Text>
          <SummaryAmounts label="معتمد / مسجّل" totals={todaySummary.confirmed} tone="confirmed" />
          <SummaryAmounts label="طلبات قيد الإجراء" totals={todaySummary.pending} tone="pending" />
          {!!todaySummary.counts.unknown && <SummaryAmounts label="تحتاج التحقق من الحالة" totals={todaySummary.unknown} tone="unknown" />}
          {!!todaySummary.counts.inactive && <Text style={styles.summaryHint}>{todaySummary.counts.inactive} سجل ملغى أو مرفوض أو معكوس مستبعد من المبالغ</Text>}
        </View>}
        ListEmptyComponent={<Text style={styles.empty}>لا توجد تحصيلات محفوظة</Text>}
        renderItem={({ item }) => <CollectionItem item={item} navigation={navigation} canViewReceipts={canViewReceipts} onPreviewReceipt={previewReceipt} />}
      />
      <ReceiptPreview receipt={receiptPreview} onClose={() => setReceiptPreview(null)} />
    </View>
  );
}

function SummaryAmounts({ label, totals, tone }: { label: string; totals: Record<string, number>; tone: 'confirmed' | 'pending' | 'unknown' }) {
  return <View style={styles.summaryRow}>
    <Text style={[styles.summaryLabel, tone === 'confirmed' && styles.confirmedStatus]}>{label}</Text>
    <View style={styles.summaryAmounts}>{Object.entries(totals).length
      ? Object.entries(totals).map(([currency, amount]) => <Text style={styles.summaryAmount} key={currency}>{amount.toLocaleString('en-US')} {currency}</Text>)
      : <Text style={styles.summaryAmount}>—</Text>}</View>
  </View>;
}

function CollectionItem({ item, navigation, canViewReceipts, onPreviewReceipt }: { item: any; navigation: any; canViewReceipts: boolean; onPreviewReceipt: (item: any) => void }) {
  const attachment = parseJsonField<any>(item.receiptAttachment, item.receiptAttachment || null);
  const bucket = collectionBucket(item);
  return (
    <View style={styles.item}>
      <TouchableOpacity
        disabled={!item.customerId}
        onPress={() => item.customerId && navigation.navigate('Customer360', { id: item.customerId })}
      >
        <View style={styles.itemHeader}>
          <Text style={styles.itemTitle}>{item.customerName || 'عميل'}</Text>
          <Text style={styles.itemAmount}>
            {Number(item.amount || 0).toLocaleString('en-US')} {item.currencyCode || ''}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={[styles.statusBadge, bucket === 'confirmed' && styles.confirmedStatus, bucket === 'inactive' && styles.inactiveStatus]}>{collectionStatusLabel(item)}</Text>
          <Text style={styles.itemMethod}>{collectionSourceLabel(item)}</Text>
        </View>
        <View style={styles.itemRow}>
          <Text style={styles.itemDate}>
            {item.collectedAt ? new Date(item.collectedAt).toLocaleDateString('ar-YE') : ''}
          </Text>
          {!!item.methodName && <Text style={styles.itemMethod}>طريقة: {item.methodName}</Text>}
        </View>
        {!!item.notes && <Text style={styles.itemNotes}>{item.notes}</Text>}
      </TouchableOpacity>
      {canViewReceipts && attachment?.id && (
        <TouchableOpacity style={styles.receiptButton} onPress={() => onPreviewReceipt(item)}>
          <Text style={styles.receiptButtonText}>معاينة صورة الإيصال</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18, backgroundColor: colors.primary, borderBottomWidth: 2, borderBottomColor: colors.gold },
  title: { fontFamily: 'TajawalBold', fontSize: 21, fontWeight: '900', color: colors.background },
  subtitle: { fontFamily: 'TajawalRegular', fontSize: 13, color: colors.background, marginTop: 4, opacity: 0.85 },
  summary: { backgroundColor: colors.surface, marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: radius.md, borderColor: colors.line, borderWidth: 1 },
  summaryTitle: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 15, textAlign: 'right', marginBottom: 8 },
  summaryRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', gap: 8, paddingVertical: 6 },
  summaryLabel: { fontFamily: 'TajawalBold', fontSize: 13, color: colors.warning, flex: 1, textAlign: 'right' },
  summaryAmounts: { alignItems: 'flex-start' },
  summaryAmount: { fontFamily: 'TajawalBold', fontSize: 13, color: colors.ink },
  summaryHint: { fontFamily: 'TajawalRegular', fontSize: 12, color: colors.muted, textAlign: 'right', marginTop: 6 },
  addBtn: { backgroundColor: colors.gold, paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.pill },
  addBtnText: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.primary, fontWeight: '900' },
  sectionTitle: { fontFamily: 'TajawalBold', fontSize: 16, fontWeight: '900', color: colors.ink, padding: 16, paddingBottom: 8, textAlign: 'right' },
  item: { backgroundColor: colors.surface, marginHorizontal: 16, marginBottom: 10, padding: 15, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, ...shadow },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemTitle: { fontFamily: 'TajawalBold', fontSize: 16, color: colors.ink, fontWeight: '800', flex: 1, textAlign: 'right' },
  itemAmount: { fontFamily: 'TajawalBold', fontSize: 16, color: colors.goldDark, fontWeight: '900' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  statusRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 8 },
  statusBadge: { fontFamily: 'TajawalBold', color: colors.warning, fontSize: 12, backgroundColor: colors.primarySoft, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  confirmedStatus: { color: colors.success }, inactiveStatus: { color: colors.danger, backgroundColor: colors.dangerSoft },
  itemDate: { fontFamily: 'TajawalRegular', fontSize: 13, color: colors.muted },
  itemMethod: { fontFamily: 'TajawalRegular', fontSize: 13, color: colors.muted },
  itemNotes: { fontFamily: 'TajawalRegular', fontSize: 14, color: colors.ink, marginTop: 6, fontStyle: 'italic', textAlign: 'right' },
  receiptButton: { alignSelf: 'flex-end', marginTop: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: colors.primarySoft },
  receiptButtonText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 13, fontWeight: '900' },
  previewScreen: { flex: 1, backgroundColor: '#0b1715' },
  previewHeader: { minHeight: 64, paddingHorizontal: 18, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.primary },
  previewTitle: { fontFamily: 'TajawalBold', flex: 1, marginLeft: 12, color: colors.background, textAlign: 'right', fontSize: 16, fontWeight: '900' },
  previewClose: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.gold, fontWeight: '900' },
  previewImage: { flex: 1, width: '100%' },
  empty: { textAlign: 'center', color: colors.muted, padding: 30 },
});
