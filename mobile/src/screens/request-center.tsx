import React from 'react';
import { isOperationsApp } from '../config/product';
import { canOpenAppRoute, isAppDocument } from '../utils/app-access';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { fetchCreatedOracleRequests } from '../api/endpoints';
import { deleteOfflineRequest, getOfflineRequests } from '../db/database';
import { useAuth } from '../store/auth-context';
import { useSync } from '../store/sync-context';
import { colors, radius, shadow } from '../theme';

type Tile = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  params?: Record<string, unknown>;
  permissions: string[];
};

const tiles: Tile[] = [
  { title: 'عروض الأسعار', icon: 'pricetags-outline', route: 'Quotations', permissions: ['sales_order_drafts.read'] },
  { title: 'طلبات العملاء', icon: 'receipt-outline', route: 'CustomerOrders', permissions: ['sales_order_drafts.read', 'oracle_test_requests.purchase.create'] },
  { title: 'سند القبض', icon: 'cash-outline', route: 'RequestVoucher', params: { kind: 'receipt' }, permissions: ['oracle_test_requests.receipt.create'] },
  { title: 'سند الصرف', icon: 'card-outline', route: 'RequestVoucher', params: { kind: 'payment' }, permissions: ['oracle_test_requests.payment.create'] },
  { title: 'القيد اليومي', icon: 'create-outline', route: 'RequestJournal', permissions: ['oracle_test_requests.journal.create'] },
  { title: 'طلب شراء', icon: 'cart-outline', route: 'RequestPurchase', permissions: ['oracle_test_requests.purchase.create'] },
  { title: 'تحويل مخزني', icon: 'swap-horizontal-outline', route: 'RequestInventoryTransfer', permissions: ['inventory_transfers.create'] },
  { title: 'الجرد', icon: 'clipboard-outline', route: 'NewInventoryCount', permissions: ['oracle_test_requests.inventory_count.create', 'mobile.inventory_count.create'] },
];

const tileDescriptions: Record<string, string> = {
  Quotations: 'عرض وإنشاء عروض أسعار غير معتمدة',
  CustomerOrders: 'طلبات نقدية وآجلة قبل الفاتورة',
  RequestVoucher: 'الطرف والحساب والعملة والإيصال',
  RequestJournal: 'أطراف مدينة ودائنة وفحص التوازن',
  RequestPurchase: 'الأصناف والوحدات والكميات المطلوبة',
  RequestInventoryTransfer: 'من مستودع المصدر إلى الوجهة',
  NewInventoryCount: 'تسجيل الكميات في مسودة جرد',
};
const kindLabels: Record<string, string> = {
  quotation: 'عرض سعر', purchase: 'طلب شراء', receipt: 'سند قبض', payment: 'سند صرف', journal: 'قيد يومي',
  inventory_transfer: 'تحويل مخزني', inventory_count: 'جرد', customer_order:'طلب عميل',
};
const statusLabels: Record<string, string> = {
  pending_approval: 'بانتظار الاعتماد', approved: 'معتمد', rejected: 'مرفوض', inactive: 'موقوف', draft: 'مسودة',
};

const draftRoute = (item: any) => {
  const common = { draftOperationId: item.operationId, draftPayload: item.payload };
  if (item.kind === 'receipt' || item.kind === 'payment') return { route: 'RequestVoucher', params: {
    ...common,
    kind: item.kind,
    customerId: item.payload?.platformCustomerId,
    customerCode: item.payload?.platformCustomerCode,
    customerName: item.payload?.recipientName,
    forceNextFollowup: item.status === 'blocked' && String(item.lastError || '').includes('التحصيل جزئي'),
  } };
  if (item.kind === 'purchase') return { route: 'RequestPurchase', params: common };
  if (item.kind === 'journal') return { route: 'RequestJournal', params: common };
  if (item.kind === 'inventory_transfer') return { route: 'RequestInventoryTransfer', params: common };
  if (item.kind === 'inventory_count') return { route: 'NewInventoryCount', params: common };
  if (item.kind === 'quotation') return item.status === 'draft' ? { route: 'NewQuotation', params: common } : { route: 'Quotations', params: {} };
  if (item.kind === 'customer_order') return { route: 'NewCustomerOrder', params: common };
  return null;
};

export default function RequestCenterScreen({ navigation }: any) {
  const { user } = useAuth();
  const { status: syncStatus } = useSync();
  const permissions = user?.permissions ?? [];
  const allowedTiles = tiles.filter((tile) => tile.permissions.some((permission) => permissions.includes(permission)) && canOpenAppRoute(tile.route, permissions));
  const created = useQuery({
    queryKey: ['mobile-oracle-created-requests'],
    queryFn: async () => (await fetchCreatedOracleRequests()).data,
    refetchInterval: 30_000,
  });
  const items = ((created.data?.items ?? []) as any[]).filter(item => isAppDocument(item.kind));
  const offline = useQuery({
    queryKey: ['mobile-offline-requests', syncStatus.pending, syncStatus.blocked],
    queryFn: getOfflineRequests,
    refetchInterval: 5_000,
  });
  const pendingItems = (offline.data ?? []).filter((item: any) => item.status !== 'synced' && (isAppDocument(item.kind)));
  const removeDraft = (item: any) => Alert.alert('حذف المسودة؟', 'سيُحذف هذا السجل المحلي فقط، ولن تُحذف أي بيانات من المنصة أو Oracle.', [
    { text: 'إلغاء', style: 'cancel' },
    { text: 'حذف', style: 'destructive', onPress: async () => { await deleteOfflineRequest(item.operationId); await offline.refetch(); } },
  ]);

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}
    refreshControl={<RefreshControl refreshing={created.isFetching} onRefresh={() => created.refetch()} tintColor={colors.primary} />}>
    <View style={styles.hero}>
      <View style={styles.heroIcon}><Ionicons name="document-text-outline" size={27} color={colors.gold} /></View>
      <View style={styles.heroText}><Text style={styles.title}>{isOperationsApp ? 'عمليات ONYX' : 'السندات المالية'}</Text><Text style={styles.subtitle}>أنشئ مسودة، أو افحص وأرسل، ثم تابع الحالة</Text></View>
    </View>
    <View style={styles.notice}>
      <Ionicons name="shield-checkmark-outline" size={21} color={colors.success} />
      <Text style={styles.noticeText}>«حفظ مسودة» يبقي العملية في قاعدة الهاتف فقط. لا يبدأ الفحص أو الإرسال إلا بعد ضغط «فحص وإرسال الطلب».</Text>
    </View>
    <View style={styles.grid}>{allowedTiles.map((tile) => <TouchableOpacity key={`${tile.route}-${tile.title}`} style={styles.tile}
      onPress={() => navigation.navigate(tile.route, tile.params)} accessibilityRole="button">
      <View style={styles.tileIcon}><Ionicons name={tile.icon} size={29} color={colors.primary} /></View>
      <Text style={styles.tileText}>{tile.title}</Text>
      <Text style={styles.tileDescription}>{tileDescriptions[tile.route]}</Text>
    </TouchableOpacity>)}</View>
    <View style={styles.sectionHeader}><TouchableOpacity onPress={() => created.refetch()}><Ionicons name="refresh" size={21} color={colors.primary} /></TouchableOpacity><Text style={styles.sectionTitle}>العمليات المنشأة وحالاتها</Text></View>
    {pendingItems.map((item: any) => { const target=draftRoute(item); const editable=item.status==='draft'||item.status==='blocked'; return <View key={item.operationId} style={styles.requestCard}><View style={styles.requestTop}><View style={[styles.status,item.status==='blocked'&&styles.statusRejected,item.status==='draft'&&styles.statusDraft]}><Text style={styles.statusText}>{item.status==='blocked'?'يحتاج معالجة':item.status==='draft'?'مسودة على الهاتف':'بانتظار الإرسال'}</Text></View><Text style={styles.requestTitle}>{item.title}</Text></View><Text style={styles.requestNumber}>{item.status==='blocked'?(item.lastError||'راجع بيانات الطلب'):item.status==='draft'?'لم تُرسل إلى المنصة أو Oracle':'دخلت طابور المزامنة بعد موافقة المستخدم'}</Text>{editable&&target?<View style={styles.draftActions}><TouchableOpacity style={styles.editDraft} onPress={()=>navigation.navigate(target.route,target.params)}><Ionicons name="create-outline" size={17} color="#fff"/><Text style={styles.editDraftText}>{item.status==='blocked'?'تصحيح وإعادة إرسال':'استعراض وتعديل'}</Text></TouchableOpacity>{item.status==='draft'?<TouchableOpacity style={styles.deleteDraft} onPress={()=>removeDraft(item)}><Ionicons name="trash-outline" size={17} color={colors.danger}/><Text style={styles.deleteDraftText}>حذف</Text></TouchableOpacity>:null}</View>:null}</View>; })}
    {created.isLoading ? <ActivityIndicator color={colors.primary} /> : created.isError ? <View style={styles.error}><Text style={styles.errorText}>تعذر تحميل الحالات من الخادم. الطلبات المحلية أعلاه محفوظة وستُزامن تلقائيًا.</Text></View>
      : items.length === 0 ? <View style={styles.empty}><Text style={styles.emptyText}>لا توجد طلبات ضمن صلاحياتك.</Text></View>
        : items.map((item) => <View key={`${item.kind}-${item.requestSerial || item.requestNo}`} style={styles.requestCard}>
          <View style={styles.requestTop}><View style={[styles.status, item.status === 'approved' && styles.statusApproved, item.status === 'rejected' && styles.statusRejected]}><Text style={styles.statusText}>{statusLabels[item.status] ?? item.status}</Text></View><Text style={styles.requestTitle}>{kindLabels[item.kind] ?? item.kind}</Text></View>
          <Text style={styles.requestNumber}>رقم الطلب: {item.requestNo ?? '—'}</Text>
          {!!item.description && <Text style={styles.requestDescription} numberOfLines={2}>{item.description}</Text>}
        </View>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, content: { padding: 14, paddingBottom: 44 },
  hero: { minHeight: 92, flexDirection: 'row-reverse', alignItems: 'center', gap: 12, backgroundColor: colors.primary, borderRadius: radius.lg, padding: 17, ...shadow },
  heroIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.12)' },
  heroText: { flex: 1 }, title: { fontFamily: 'TajawalBold', color: '#fff', fontSize: 23, fontWeight: '900', textAlign: 'right' }, subtitle: { color: '#DCEDE8', marginTop: 4, textAlign: 'right' },
  notice: { marginTop: 12, flexDirection: 'row-reverse', gap: 9, backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 12 },
  noticeText: { fontFamily: 'TajawalBold', fontSize: 15, flex: 1, color: colors.ink, lineHeight: 20, textAlign: 'right', fontWeight: '700' },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 14 },
  tile: { width: '48.5%', minHeight: 146, padding: 12, marginBottom: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, ...shadow },
  tileIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldSoft },
  tileDescription: { fontFamily: 'TajawalRegular', fontSize: 13, lineHeight: 20, color: colors.muted, textAlign: 'center', marginTop: 5 },
  tileText: { fontFamily: 'TajawalBold', marginTop: 10, color: colors.ink, fontSize: 16, fontWeight: '900' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, marginBottom: 9 }, sectionTitle: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 18, fontWeight: '900' },
  requestCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 13, borderWidth: 1, borderColor: colors.line, marginBottom: 9 },
  requestTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, requestTitle: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 16, fontWeight: '900' },
  status: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: colors.goldSoft }, statusApproved: { backgroundColor: colors.primarySoft }, statusRejected: { backgroundColor: '#FDECEC' }, statusDraft:{backgroundColor:'#E9F1FF'}, statusText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 13, fontWeight: '900' },
  requestNumber: { color: colors.muted, textAlign: 'right', marginTop: 7 }, requestDescription: { color: colors.ink, textAlign: 'right', marginTop: 5 },
  draftActions:{flexDirection:'row-reverse',gap:8,marginTop:10}, editDraft:{flex:1,minHeight:40,borderRadius:radius.sm,backgroundColor:colors.primary,flexDirection:'row-reverse',alignItems:'center',justifyContent:'center',gap:6},editDraftText:{ fontFamily: 'TajawalBold', fontSize: 15,color:'#fff',fontWeight:'900'},deleteDraft:{minWidth:88,minHeight:40,borderRadius:radius.sm,borderWidth:1,borderColor:colors.danger,flexDirection:'row-reverse',alignItems:'center',justifyContent:'center',gap:5},deleteDraftText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.danger,fontWeight:'900'},
  error: { backgroundColor: '#FDECEC', borderRadius: radius.md, padding: 14 }, errorText: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.danger, textAlign: 'right', fontWeight: '800' },
  empty: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 18 }, emptyText: { color: colors.muted, textAlign: 'center' },
});
