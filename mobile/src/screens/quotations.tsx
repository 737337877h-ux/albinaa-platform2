import React from 'react';
import { ActivityIndicator, Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getClient } from '../api/client';
import { fetchQuotationDetail, fetchQuotationsOfflineSnapshot } from '../api/quotations';
import { getOfflineRequests, getReferenceOptions, markOfflineRequestResult, resubmitMutation } from '../db/database';
import { useAuth } from '../store/auth-context';
import { useSync } from '../store/sync-context';
import { colors, radius } from '../theme';

const statusLabel = (row: any) => Number(row.INACTIVE) ? 'موقوف' : Number(row.PROCESSED) ? 'تمت معالجته' : Number(row.APPROVED) ? 'معتمد' : 'غير معتمد';

export default function QuotationsScreen({ navigation }: any) {
  const { user } = useAuth();
  const { status, triggerSync } = useSync();
  const [search, setSearch] = React.useState('');
  const [refreshing, setRefreshing] = React.useState(false);
  const [notice, setNotice] = React.useState('البيانات المحفوظة على الهاتف؛ اسحب للتحديث.');
  const [selected, setSelected] = React.useState<any>();
  const [detail, setDetail] = React.useState<any>();
  const [detailError, setDetailError] = React.useState('');
  const readId = React.useRef(0);
  const canRead = !!user?.permissions?.includes('sales_order_drafts.read');
  const canManage = !!user?.permissions?.includes('sales_order_drafts.manage');
  const local = useQuery({ queryKey: ['quotations-local', user?.id, status.lastSyncAt, status.pending, status.blocked],
    enabled: canRead, refetchInterval: 5000,
    queryFn: async () => ({ rows: await getReferenceOptions('quotations'), requests: (await getOfflineRequests()).filter((row: any) => row.kind === 'quotation'), receipts: await getReferenceOptions('quotationReceipts') }),
  });
  const capabilities = useQuery({ queryKey: ['quotation-capabilities', user?.id], enabled: canRead,
    queryFn: async () => (await (await getClient()).get('/quotations/capabilities')).data, retry: false });
  const refresh = React.useCallback(async () => {
    if (!canRead) return;
    setRefreshing(true);
    try {
      await fetchQuotationsOfflineSnapshot();
      setNotice('تم تحديث عروض الأسعار من Oracle 2026.');
    } catch { setNotice('تعذر التحديث. المعروض آخر بيانات محفوظة على الهاتف.'); }
    finally { await local.refetch(); setRefreshing(false); }
  }, [canRead, local.refetch]);
  useFocusEffect(React.useCallback(() => { void refresh(); }, [refresh]));
  const open = async (row: any) => {
    const id = ++readId.current;
    setSelected(row); setDetail(undefined); setDetailError('');
    try { const result = await fetchQuotationDetail(String(row.SERIAL)); if (id === readId.current) setDetail(result); }
    catch (error: any) { if (id === readId.current) setDetailError(error.message || 'تعذر تحميل التفاصيل'); }
  };
  const close = () => { readId.current++; setSelected(undefined); };
  const retry = async (operationId: string) => {
    try {
      const row = (await getOfflineRequests()).find((item: any) => item.operationId === operationId);
      if (!row || row.status === 'synced' || row.status === 'draft') return;
      await resubmitMutation(row.operationId, 'POST', '/quotations', row.payload);
      await markOfflineRequestResult(row.operationId, 'pending');
      await triggerSync();
      await local.refetch();
    } catch { Alert.alert('المزامنة', 'تعذر الاتصال؛ بقي العرض محفوظًا في الطابور.'); }
  };
  const rows = [...(local.data?.rows || [])].filter(row => `${row.DOCUMENT_NO} ${row.CUSTOMER_NAME} ${row.CURRENCY}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => String(b.SERIAL).length - String(a.SERIAL).length || String(b.SERIAL).localeCompare(String(a.SERIAL)));
  const requests = local.data?.requests || [];
  const pending = requests.filter((row: any) => row.status !== 'synced');
  const receipts = local.data?.receipts || [];
  if (!canRead) return <Text style={styles.notice}>لا تملك صلاحية عرض عروض الأسعار.</Text>;
  return <>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} />}>
      <Text style={styles.heading}>عروض الأسعار</Text>
      <Text style={styles.notice}>{notice}</Text>
      {!!local.data?.rows?.[0]?.cachedAt && <Text style={styles.notice}>آخر حفظ: {new Date(local.data.rows[0].cachedAt).toLocaleString('ar')}</Text>}
      {canManage && capabilities.data?.createEnabled !== false && <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('NewQuotation')}><Text style={styles.buttonText}>+ عرض سعر جديد</Text></TouchableOpacity>}
      {canManage && capabilities.data?.createEnabled === false && <Text style={styles.notice}>إنشاء عروض الأسعار غير مفعّل لهذا الحساب حاليًا.</Text>}
      {pending.map((row: any) => <View key={row.operationId} style={styles.card}>
        <Text style={styles.title}>{row.title}</Text>
        <Text style={styles.notice}>{row.status === 'draft' ? 'مسودة على الهاتف' : row.status === 'blocked' ? `يحتاج معالجة: ${row.lastError || ''}` : 'بانتظار تأكيد الحفظ من Oracle'}</Text>
        {row.status === 'draft' && canManage ? <TouchableOpacity onPress={() => navigation.navigate('NewQuotation', { draftPayload: row.payload, draftOperationId: row.operationId })}><Text style={styles.link}>استعراض وتعديل</Text></TouchableOpacity>
          : canManage && <TouchableOpacity onPress={() => { void retry(row.operationId); }}><Text style={styles.link}>إعادة المزامنة بنفس البيانات</Text></TouchableOpacity>}
      </View>)}
      {receipts.slice(-10).reverse().map((row: any) => <Text key={row.id} style={styles.notice}>✓ تأكد حفظ عرض السعر رقم {row.number} في Oracle</Text>)}
      <TextInput style={styles.search} placeholder="ابحث برقم العرض أو العميل" value={search} onChangeText={setSearch} textAlign="right" />
      <Text style={styles.notice}>{rows.length} عرض سعر</Text>
      {local.isLoading && <ActivityIndicator color={colors.primary} />}
      {rows.map(row => <TouchableOpacity key={row.SERIAL} style={styles.card} onPress={() => { void open(row); }}>
        <Text style={styles.title}>عرض رقم {row.DOCUMENT_NO} — {statusLabel(row)}</Text>
        <Text style={styles.text}>{row.CUSTOMER_NAME || '—'}</Text>
        <Text style={styles.notice}>{row.DOCUMENT_DATE} • الفرع {row.BRANCH_NO}</Text>
        <Text style={styles.title}>قيمة الأصناف: {row.AMOUNT ?? '—'} {row.CURRENCY}</Text>
        <Text style={styles.notice}>الخصم: {row.DISCOUNT || '0'}</Text>
        <Text style={styles.link}>عرض الأصناف والتفاصيل</Text>
      </TouchableOpacity>)}
      {!rows.length && !local.isLoading && <Text style={styles.notice}>لا توجد عروض محفوظة تطابق البحث.</Text>}
    </ScrollView>
    <Modal visible={!!selected} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={close}><Text style={styles.link}>إغلاق</Text></TouchableOpacity>
        <Text style={styles.heading}>عرض رقم {selected?.DOCUMENT_NO}</Text>
        <Text style={styles.text}>{selected?.CUSTOMER_NAME}</Text>
        <Text style={styles.notice}>{selected && statusLabel(selected)} • {selected?.DOCUMENT_DATE}</Text>
        {detail?.offline && <Text style={styles.notice}>تفاصيل محفوظة بتاريخ {new Date(detail.cachedAt).toLocaleString('ar')}</Text>}
        {!detail && !detailError && <ActivityIndicator color={colors.primary} />}
        {!!detailError && <Text style={styles.notice}>{detailError}</Text>}
        {(detail?.lines || []).map((line: any, index: number) => <View key={`${line.LINE_NO}-${index}`} style={styles.card}>
          <Text style={styles.title}>{line.DESCRIPTION || line.ITEM_CODE}</Text>
          <Text style={styles.text}>{line.ITEM_CODE} • {line.UNIT} • المخزن {line.WAREHOUSE}</Text>
          <Text style={styles.text}>الكمية {line.QUANTITY} × السعر {line.PRICE} {selected?.CURRENCY}</Text>
          <Text style={styles.notice}>خصم الوحدة {line.DISCOUNT || '0'}</Text>
        </View>)}
        <Text style={styles.title}>قيمة الأصناف: {selected?.AMOUNT} {selected?.CURRENCY}</Text>
        <Text style={styles.notice}>الخصم: {selected?.DISCOUNT || '0'} • الضريبة: {selected?.VAT || '0'}</Text>
        <Text style={styles.notice}>مصاريف أخرى: {selected?.OTHER_AMOUNT || '0'}</Text>
      </ScrollView></SafeAreaView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, content: { padding: 16, paddingBottom: 50, gap: 12 },
  heading: { fontFamily: 'TajawalBold', fontSize: 24, color: colors.primary, textAlign: 'right' },
  title: { fontFamily: 'TajawalBold', fontSize: 17, color: colors.ink, textAlign: 'right' },
  text: { fontFamily: 'TajawalRegular', color: colors.ink, textAlign: 'right', lineHeight: 24 },
  notice: { fontFamily: 'TajawalRegular', color: colors.muted, textAlign: 'right', lineHeight: 24 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 15, borderRadius: radius.md, gap: 8 },
  button: { backgroundColor: colors.primary, padding: 15, borderRadius: radius.md },
  buttonText: { fontFamily: 'TajawalBold', color: '#fff', textAlign: 'center', fontSize: 17 },
  link: { fontFamily: 'TajawalBold', color: colors.primary, paddingVertical: 8, textAlign: 'right' },
  search: { padding: 12, minHeight: 48, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, borderRadius: radius.md, color: colors.ink },
});
