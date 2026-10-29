import React from 'react';
import { Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { countCustomerOrdersOffline, enqueueMutation, listCustomerOrdersOffline, updateCustomerOrderOffline } from '../db/database';
import { useSync } from '../store/sync-context';
import { colors, radius, shadow } from '../theme';

type Kind = 'all' | 'cash' | 'credit' | 'other';
const kindLabel: Record<string, string> = { cash: 'نقدي', credit: 'آجل', other: 'أخرى' };

function operationId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function CustomerOrdersScreen({ navigation }: any) {
  const { triggerSync, status } = useSync();
  const [items, setItems] = React.useState<any[]>([]);
  const [kind, setKind] = React.useState<Kind>('all');
  const [search, setSearch] = React.useState('');
  const [refreshing, setRefreshing] = React.useState(false);
  const [visibleLimit, setVisibleLimit] = React.useState(100);
  const [total, setTotal] = React.useState(0);
  const [editing, setEditing] = React.useState<any | null>(null);
  const [customerCode, setCustomerCode] = React.useState('');
  const [customerName, setCustomerName] = React.useState('');

  const load = React.useCallback(async () => {
    const [rows, count] = await Promise.all([
      listCustomerOrdersOffline({ kind, search, limit: visibleLimit }),
      countCustomerOrdersOffline({ kind, search }),
    ]);
    setItems(rows); setTotal(count);
  }, [kind, search, visibleLimit]);
  React.useEffect(() => { setVisibleLimit(100); }, [kind, search]);
  React.useEffect(() => { load().catch(() => undefined); }, [load, status.lastSyncAt]);

  const refresh = async () => {
    setRefreshing(true);
    try { await triggerSync(); await load(); } finally { setRefreshing(false); }
  };
  const openEdit = (item: any) => {
    setEditing(item);
    setCustomerCode(String(item.proposedCustomerCode ?? item.sourceCustomerCode ?? ''));
    setCustomerName(String(item.proposedCustomerName ?? item.sourceCustomerName ?? ''));
  };
  const saveEdit = async () => {
    const code = customerCode.trim();
    const name = customerName.trim();
    if (!name) return Alert.alert('بيانات ناقصة', 'أدخل اسم العميل.');
    if (editing.orderKind === 'credit' && !code) return Alert.alert('رقم العميل مطلوب', 'الطلب الآجل يجب ربطه برقم العميل.');
    const patch = { proposedCustomerCode: code || null, proposedCustomerName: name };
    await updateCustomerOrderOffline(editing.id, patch);
    await enqueueMutation(operationId('customer-order-edit'), 'PATCH', `/sales-order-drafts/${editing.id}`, patch);
    setEditing(null);
    await load();
    Alert.alert('حُفظ محليًا', 'سيُرسل التعديل إلى المنصة تلقائيًا عند عودة الاتصال. ولا تتم أي كتابة في Oracle.');
  };
  const process = async (item: any) => {
    if (item.validationStatus === 'blocked') return Alert.alert('يحتاج معالجة', 'صحح اسم العميل أو رقمه وبيانات الطلب قبل إرساله للمراجعة.');
    await updateCustomerOrderOffline(item.id, { status: 'ready_for_approval' });
    await enqueueMutation(operationId('customer-order-process'), 'POST', `/sales-order-drafts/${item.id}/process`, { status: 'ready_for_approval' });
    await load();
    Alert.alert('تمت الجدولة للمراجعة', 'حُفظ تغيير حالة الطلب في الهاتف وسيصل إلى المنصة عند المزامنة. هذا لا ينشئ فاتورة مبيعات.');
  };

  return <>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
      <TouchableOpacity style={styles.newOrder} onPress={() => navigation.navigate('NewCustomerOrder')}><Ionicons name="add-circle-outline" size={21} color="#fff" /><Text style={styles.newOrderText}>طلب عميل جديد</Text></TouchableOpacity>
      <View style={styles.notice}><Ionicons name="phone-portrait-outline" size={20} color={colors.success} /><Text style={styles.noticeText}>طلبات ARST003 تسبق فاتورة المبيعات وتعمل هنا من قاعدة الهاتف بلا اتصال. النقدي يكفيه الاسم، والآجل يجب أن يحمل رقم العميل.</Text></View>
      <TextInput value={search} onChangeText={setSearch} placeholder="ابحث برقم الطلب أو العميل أو الاسم" style={styles.search} textAlign="right" />
      <View style={styles.filters}>{(['all','cash','credit','other'] as Kind[]).map((value) => <TouchableOpacity key={value} onPress={() => setKind(value)} style={[styles.filter, kind === value && styles.filterActive]}><Text style={[styles.filterText, kind === value && styles.filterTextActive]}>{value === 'all' ? 'الكل' : kindLabel[value]}</Text></TouchableOpacity>)}</View>
      <Text style={styles.count}>إجمالي {total.toLocaleString('en-US')} طلب محفوظ محليًا · المعروض {items.length.toLocaleString('en-US')}</Text>
      {items.map((item) => <View key={item.id} style={styles.card}>
        <View style={styles.top}><View style={styles.kind}><Text style={styles.kindText}>{kindLabel[item.orderKind] ?? 'أخرى'}</Text></View><Text style={styles.order}>طلب {item.sourceOrderNo || item.sourceOrderSerial}</Text></View>
        <Text style={styles.customer}>{item.proposedCustomerName || item.sourceCustomerName || 'اسم غير محدد'}</Text>
        <Text style={styles.meta}>{item.proposedCustomerCode || item.sourceCustomerCode ? `رقم العميل: ${item.proposedCustomerCode || item.sourceCustomerCode}` : 'طلب نقدي بالاسم فقط'}</Text>
        <Text style={styles.meta}>{Number(item.sourceAmount || 0).toLocaleString('en-US')} {item.currencyCode || ''} · {String(item.sourceOrderDate || '').slice(0, 10)}</Text>
        <View style={styles.actions}><TouchableOpacity style={styles.secondary} onPress={() => openEdit(item)}><Text style={styles.secondaryText}>تعديل الربط</Text></TouchableOpacity><TouchableOpacity style={styles.primary} onPress={() => process(item)}><Text style={styles.primaryText}>{item.status === 'ready_for_approval' ? 'مجدول للمراجعة' : 'إرسال للمراجعة'}</Text></TouchableOpacity></View>
      </View>)}
      {items.length < total && <TouchableOpacity style={styles.loadMore} onPress={() => setVisibleLimit((value) => value + 100)}><Text style={styles.loadMoreText}>عرض 100 طلب إضافي</Text></TouchableOpacity>}
      {!items.length && <View style={styles.empty}><Text style={styles.emptyText}>لا توجد نتائج في اللقطة المحلية. اسحب للتحديث عند توفر الشبكة.</Text></View>}
    </ScrollView>
    <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
      <View style={styles.modalShade}><View style={styles.modalCard}><Text style={styles.modalTitle}>ربط طلب العميل</Text>
        <Text style={styles.label}>اسم العميل</Text><TextInput value={customerName} onChangeText={setCustomerName} style={styles.input} textAlign="right" />
        {editing?.orderKind === 'credit' && <><Text style={styles.label}>رقم العميل للطلب الآجل</Text><TextInput value={customerCode} onChangeText={setCustomerCode} style={styles.input} keyboardType="number-pad" textAlign="right" /></>}
        <View style={styles.actions}><TouchableOpacity style={styles.secondary} onPress={() => setEditing(null)}><Text style={styles.secondaryText}>إلغاء</Text></TouchableOpacity><TouchableOpacity style={styles.primary} onPress={saveEdit}><Text style={styles.primaryText}>حفظ محليًا</Text></TouchableOpacity></View>
      </View></View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:colors.background},content:{padding:14,paddingBottom:40},newOrder:{minHeight:50,flexDirection:'row-reverse',gap:7,alignItems:'center',justifyContent:'center',backgroundColor:colors.primary,borderRadius:radius.md,marginBottom:10},newOrderText:{ fontFamily: 'TajawalBold', fontSize: 15,color:'#fff',fontWeight:'900'},notice:{flexDirection:'row-reverse',gap:8,padding:12,borderRadius:radius.md,backgroundColor:colors.primarySoft},noticeText:{ fontFamily: 'TajawalBold', fontSize: 15,flex:1,textAlign:'right',color:colors.ink,lineHeight:20,fontWeight:'700'},search:{marginTop:12,backgroundColor:colors.surface,borderRadius:radius.md,borderWidth:1,borderColor:colors.line,paddingHorizontal:14,paddingVertical:12,color:colors.ink},filters:{flexDirection:'row-reverse',gap:7,marginTop:10},filter:{flex:1,paddingVertical:9,borderRadius:999,borderWidth:1,borderColor:colors.line,alignItems:'center'},filterActive:{backgroundColor:colors.primary,borderColor:colors.primary},filterText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.muted,fontWeight:'800'},filterTextActive:{color:'#fff'},count:{ fontFamily: 'TajawalBold', fontSize: 15,textAlign:'right',marginVertical:11,color:colors.muted,fontWeight:'700'},card:{backgroundColor:colors.surface,borderRadius:radius.lg,borderWidth:1,borderColor:colors.line,padding:14,marginBottom:10,...shadow},top:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},kind:{backgroundColor:colors.goldSoft,borderRadius:999,paddingHorizontal:9,paddingVertical:4},kindText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.primary,fontWeight:'900'},order:{ fontFamily: 'TajawalBold',color:colors.ink,fontWeight:'900',fontSize:16},customer:{ fontFamily: 'TajawalBold',textAlign:'right',color:colors.ink,fontWeight:'900',fontSize:16,marginTop:10},meta:{textAlign:'right',color:colors.muted,marginTop:5},actions:{flexDirection:'row',gap:8,marginTop:13},primary:{flex:1,backgroundColor:colors.primary,borderRadius:radius.md,padding:11,alignItems:'center'},primaryText:{ fontFamily: 'TajawalBold', fontSize: 15,color:'#fff',fontWeight:'900'},secondary:{flex:1,borderWidth:1,borderColor:colors.primary,borderRadius:radius.md,padding:11,alignItems:'center'},secondaryText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.primary,fontWeight:'900'},loadMore:{borderWidth:1,borderColor:colors.primary,borderRadius:radius.md,padding:13,alignItems:'center',marginTop:3},loadMoreText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.primary,fontWeight:'900'},empty:{padding:20,backgroundColor:colors.surface,borderRadius:radius.md},emptyText:{textAlign:'center',color:colors.muted},modalShade:{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(0,0,0,.35)'},modalCard:{backgroundColor:colors.surface,borderTopLeftRadius:24,borderTopRightRadius:24,padding:18,paddingBottom:34},modalTitle:{ fontFamily: 'TajawalBold',textAlign:'right',fontSize:20,fontWeight:'900',color:colors.ink},label:{ fontFamily: 'TajawalBold', fontSize: 15,textAlign:'right',marginTop:13,marginBottom:6,color:colors.ink,fontWeight:'800'},input:{borderWidth:1,borderColor:colors.line,borderRadius:radius.md,padding:12,color:colors.ink},
});
