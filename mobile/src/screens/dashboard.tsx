import {reservationSummary} from '../utils/reservation-summary';
import React from 'react';
import {
  Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../store/auth-context';
import { useSync } from '../store/sync-context';
import { getAll, getMeta } from '../db/database';
import { colors, radius, shadow } from '../theme';
import { BalanceSide, customerEngagementIds, formatBalance, grossTotalsByCurrencySide, hasNoRecordedFollowup, largestActionableDebtorBalance, totalActionableDebtorBalance, totalSignificantBalance, totalsByCurrencySide } from '../utils/customer';
import { canUseMobileFeature } from '../utils/mobile-permissions';
import brandImage from '../../assets/alraqi-header-flat-approved.png';
import { collapseTasksByCustomer, isDueForTodayWork } from '../utils/tasks';
import { isLocalToday, localDateKey } from '../utils/local-date';
import { promiseSummary } from '../utils/promises';

export default function DashboardScreen({ navigation }: any) {
  const { user } = useAuth();
  const { status, triggerSync } = useSync();
  const [data, setData] = React.useState<{ tasks: any[]; collections: any[]; customers: any[]; followups: any[]; promises: any[]; reservations: any[]; newDebt: any | null; customerAlerts: any | null }>({ tasks: [], collections: [], customers: [], followups: [], promises: [], reservations: [], newDebt: null, customerAlerts: null });

  const load = React.useCallback(async () => {
    const [tasks, collections, customers, followups, promises, reservations, newDebtJson, customerAlertsJson] = await Promise.all([
      getAll('tasks'), getAll('collections'), getAll('customers'), getAll('followups'), getAll('promises'), getAll('reservations'), getMeta('newDebt'), getMeta('customerAlerts'),
    ]);
    let newDebt = null;
    let customerAlerts = null;
    try { newDebt = newDebtJson ? JSON.parse(newDebtJson) : null; } catch { /* keep unavailable */ }
    try { customerAlerts = customerAlertsJson ? JSON.parse(customerAlertsJson) : null; } catch { /* keep unavailable */ }
    setData({ tasks, collections, customers, followups, promises, reservations, newDebt, customerAlerts });
  }, []);

  useFocusEffect(React.useCallback(() => { load(); }, [load]));
  React.useEffect(() => {
    if (status.phase === 'synced' && status.lastSyncAt) load();
  }, [load, status.lastSyncAt, status.phase]);
  const today = localDateKey(new Date());
  const allCustomerAccounts = data.customers.filter((c) => c.customerType !== 'advance' && !c.balanceHidden);
  const customerAccounts = data.customers.filter((c) => c.customerType !== 'advance'
    && (c.balanceHidden || totalActionableDebtorBalance(c.balances) > 0));
  const advances = data.customers.filter((c) => c.customerType === 'advance'
    && (c.balanceHidden || totalSignificantBalance(c.balances) > 0));
  const todayTasks = collapseTasksByCustomer(data.tasks.filter((task) => isDueForTodayWork(task.dueDate, today) && task.status !== 'completed'));
  const overdue = collapseTasksByCustomer(data.tasks.filter((task) => task.dueDate && String(task.dueDate).slice(0, 10) < today && task.status !== 'completed'));
  const todayCollections = data.collections.filter((item) => isLocalToday(item.collectedAt, today));
  const promiseCounts = promiseSummary(data.promises, today);
  const promiseDetail = [
    `${promiseCounts.upcoming} قادمة`,
    ...(promiseCounts.today ? [`${promiseCounts.today} اليوم`] : []),
    `${promiseCounts.overdue} متأخرة`,
  ].join(' · ');
  const reservations=reservationSummary(data.reservations);
  // Match the web dashboard definition of debt: positive debtor balances only.
  // Customer credit balances are reported separately and do not reduce debt.
  const customerTotals = grossTotalsByCurrencySide(allCustomerAccounts, 'debtor');
  const advanceDebtorTotals = totalsByCurrencySide(advances, 'debtor');
  const advanceCreditorTotals = totalsByCurrencySide(advances, 'creditor');
  const priorities = [...customerAccounts, ...advances]
    .filter((account) => totalActionableDebtorBalance(account.balances) > 0)
    .sort((a, b) => totalActionableDebtorBalance(b.balances) - totalActionableDebtorBalance(a.balances)).slice(0, 5);
  const engagedCustomerIds = customerEngagementIds(data.followups.filter((f:any) => !f.deletedAt));
  const neverFollowedCustomers = customerAccounts.filter((account) => account.assignedCollectorName
    && totalActionableDebtorBalance(account.balances) > 0
    && hasNoRecordedFollowup(account, engagedCustomerIds));
  const permissions = user?.permissions ?? [];
  const canViewReservations=canUseMobileFeature(permissions,'mobile.reservations.view','reservations.read');
  const canViewTasks = canUseMobileFeature(permissions, 'mobile.tasks.view', 'tasks.manage');
  const canViewCollections = canUseMobileFeature(permissions, 'mobile.collections.view', 'collections.create');
  const canViewPromises = canUseMobileFeature(permissions, 'mobile.promises.view', 'promises.create');
  const canViewRequests = permissions.some((permission) => ['oracle_test_requests.receipt.create','oracle_test_requests.payment.create','oracle_test_requests.journal.create'].includes(permission));

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={status.phase === 'syncing'} onRefresh={async () => { await triggerSync(); await load(); }} tintColor={colors.gold} />}
    >
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('Notifications')}>
            <Ionicons name="notifications-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <Image source={brandImage} style={styles.logo} resizeMode="contain" />
          <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('Settings')}>
            <Ionicons name="settings-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
        <Text style={styles.greeting}>مرحباً، {user?.fullName?.split(' ')[0] || 'المحصّل'}</Text>
        <Text style={styles.tagline}>قرار أسرع. متابعة أدق. تحصيل أفضل.</Text>
        <TouchableOpacity style={styles.syncRow} onPress={() => navigation.navigate('Settings')}>
          <Ionicons name={status.phase === 'synced' ? 'checkmark-circle' : status.phase === 'syncing' ? 'sync' : 'cloud-offline-outline'} size={16} color={status.phase === 'synced' ? '#A9E4CF' : '#F4D28D'} />
          <Text style={styles.syncText}>{status.phase === 'synced' ? 'البيانات محفوظة ومتزامنة' : status.phase === 'syncing' ? 'جارٍ تحديث البيانات' : 'تعمل الآن دون اتصال'}</Text>
          {(status.pending + status.blocked) > 0 && <Text style={styles.queueBadge}>{status.pending + status.blocked}</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.quickGrid}>
        {canViewTasks && <Metric icon="checkbox-outline" label="مهام اليوم" value={todayTasks.length} tone="green" onPress={() => navigation.navigate('Tasks', { initialFilter: 'today' })} />}
        {canViewTasks && <Metric icon="alert-circle-outline" label="متأخرة" value={overdue.length} tone="red" onPress={() => navigation.navigate('Tasks', { initialFilter: 'overdue' })} />}
        {canViewCollections && <Metric icon="cash-outline" label="تحصيلات اليوم" value={todayCollections.length} tone="gold" onPress={() => navigation.navigate('CollectionsList')} />}
        {canViewPromises && <Metric icon="calendar-outline" label="وعود قيد المتابعة" value={promiseCounts.active} detail={promiseDetail} tone="neutral" onPress={() => navigation.navigate('PromisesList', { initialFilter: 'active' })} />}
        {canViewRequests && <Metric icon="documents-outline" label="السندات المالية" value="فتح" tone="gold" onPress={() => navigation.navigate('RequestCenter')} />}
      </View>

      {canViewReservations && <ReservationMetric summary={reservations} onPress={()=>navigation.navigate('Reservations')}/>}

      {!!user?.permissions?.includes('customers.read_all') && data.customerAlerts && (
        <View style={styles.customerAlertsCard}>
          <View style={styles.customerAlertsHeader}>
            <Ionicons name="notifications-outline" size={19} color={colors.gold} />
            <View style={{ flex: 1 }}><Text style={styles.customerAlertsTitle}>تنبيهات الإسناد والعملاء الجدد</Text><Text style={styles.customerAlertsSubtitle}>تعمل من آخر مزامنة محفوظة على الهاتف</Text></View>
          </View>
          <View style={styles.customerAlertsRow}>
            <TouchableOpacity style={[styles.customerAlert, styles.customerAlertWarning]} onPress={() => navigation.navigate('Customers', { alertFilter: 'unassigned', createdSince: undefined })}>
              <Text style={styles.customerAlertCount}>{Number(data.customerAlerts.unassigned || 0).toLocaleString('en-US')}</Text>
              <Text style={styles.customerAlertLabel}>دون محصّل</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.customerAlert, styles.customerAlertNew]} onPress={() => navigation.navigate('Customers', { alertFilter: 'new', createdSince: data.customerAlerts.since })}>
              <Text style={styles.customerAlertCount}>{Number(data.customerAlerts.newCustomers || 0).toLocaleString('en-US')}</Text>
              <Text style={styles.customerAlertLabel}>عملاء جدد</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {canViewTasks && (
        <TouchableOpacity style={styles.neverFollowedCard} onPress={() => navigation.navigate('Customers', { alertFilter: 'never_followed', createdSince: undefined })}>
          <Ionicons name="person-remove-outline" size={22} color={colors.danger} />
          <View style={styles.neverFollowedMain}>
            <Text style={styles.neverFollowedTitle}>لم تُسجّل لهم متابعة</Text>
            <Text style={styles.neverFollowedSubtitle}>لم تُسجّل أي متابعة لهذه الحسابات</Text>
          </View>
          <Text style={styles.neverFollowedCount}>{neverFollowedCustomers.length.toLocaleString('en-US')}</Text>
        </TouchableOpacity>
      )}

      <SectionHeader title="محفظة المديونية" subtitle="الأرصدة حسب العملة ونوع الحساب" />
      <View style={styles.portfolioCard}>
        <PortfolioAccount title="العملاء" count={customerAccounts.length} totals={customerTotals} icon="people-outline" onPress={() => navigation.navigate('Customers', { currencyFilter: undefined, balanceSide: undefined })} onCurrencyPress={(currency: string) => navigation.navigate('Customers', { currencyFilter: currency, balanceSide: 'debtor' })} />
        <View style={styles.portfolioDivider} />
        <PortfolioAccount title="السلف" count={advances.length} totals={advanceDebtorTotals} creditorTotals={advanceCreditorTotals} icon="wallet-outline" onPress={() => navigation.navigate('Advances', { currencyFilter: undefined, balanceSide: undefined })} onCurrencyPress={(currency: string, side: BalanceSide) => navigation.navigate('Advances', { currencyFilter: currency, balanceSide: side })} />
      </View>

      <NewDebtCard value={data.newDebt} onPress={() => navigation.navigate('DebtChangeDetails', { value: data.newDebt })} />

      <SectionHeader title="أولوية التواصل" subtitle="أعلى الحسابات رصيداً في نطاق إسنادك" />
      <View style={styles.debtorRule}><Ionicons name="filter-circle" size={16} color={colors.primary} /><Text style={styles.debtorRuleText}>يستبعد الصافي والدائن وحتى 3,000 YER · 30 SAR · 5 USD</Text></View>
      <View style={styles.priorityCard}>
        {priorities.length === 0 ? <Text style={styles.empty}>لا توجد حسابات مدينة حالياً</Text> : priorities.map((account, index) => (
          <TouchableOpacity
            key={account.id}
            style={[styles.priorityRow, index > 0 && styles.priorityBorder]}
            onPress={() => navigation.navigate('Customer360', { id: String(account.id), customer: account })}
          >
            <View style={styles.rank}><Text style={styles.rankText}>{index + 1}</Text></View>
            <View style={styles.priorityMain}>
              <Text style={styles.priorityName} numberOfLines={1}>{account.fullName}</Text>
              <Text style={styles.priorityMeta}>{account.customerType === 'advance' ? 'سلفة' : 'عميل'} · #{account.externalCustomerCode || account.accountNumber || '—'}</Text>
              {!!user?.permissions?.includes('customers.read_all') && (
                <Text style={styles.priorityCollector}>المحصّل: {account.assignedCollectorName || 'غير مسند'}</Text>
              )}
            </View>
            <BalanceCompact balances={account.balances} />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

function Metric({ icon, label, value, detail, tone, onPress }: any) {
  const toneStyle: any = { green: colors.success, red: colors.danger, gold: colors.warning, neutral: colors.secondary };
  return (
    <TouchableOpacity style={styles.metric} onPress={onPress}>
      <View style={[styles.metricIcon, { backgroundColor: `${toneStyle[tone]}16` }]}><Ionicons name={icon} size={21} color={toneStyle[tone]} /></View>
      <Text style={styles.metricValue}>{typeof value === 'number' ? value.toLocaleString('en-US') : value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      {!!detail && <Text style={styles.metricDetail}>{detail}</Text>}
    </TouchableOpacity>
  );
}

function ReservationMetric({summary,onPress}:{summary:ReturnType<typeof reservationSummary>;onPress:()=>void}) {
 const labels:Record<string,string>={YER:'ريال يمني',SAR:'ريال سعودي'};
 return <TouchableOpacity accessibilityRole="button" accessibilityLabel="فتح حجوزات البضاعة" style={styles.reservationMetric} onPress={onPress}>
  <View style={{flexDirection:'row-reverse',alignItems:'center',gap:8}}><Ionicons name="bookmark-outline" size={24} color={colors.warning}/><Text style={{flex:1,textAlign:'right',fontFamily:'TajawalBold',fontSize:18,color:colors.ink}}>حجوزات البضاعة</Text><Ionicons name="chevron-back" size={20} color={colors.primary}/></View>
  <Text style={styles.reservationTons}>{summary.count.toLocaleString('en-US')} حجز فعّال · الكمية المتبقية</Text>
  {Object.entries(summary.quantities).map(([unit,value])=><Text key={unit} style={styles.reservationTons}>{formatBalance(value)} {unit}</Text>)}
  {!summary.count&&<Text style={styles.reservationTons}>لا توجد حجوزات فعّالة</Text>}
  {Object.entries(summary.totals).map(([currency,value])=><Text key={currency} style={styles.reservationValue}>{formatBalance(value)} {labels[currency]||currency}</Text>)}
  <Text style={styles.metricLabel}>قيمة البضاعة المتبقية حسب آخر مزامنة</Text>
 </TouchableOpacity>;
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionSubtitle}>{subtitle}</Text></View>;
}

function PortfolioAccount({ title, count, totals, creditorTotals, icon, onPress, onCurrencyPress }: any) {
  const debtorEntries = Object.entries(totals).filter(([, amount]) => Number(amount) > 0);
  const creditorEntries = Object.entries(creditorTotals ?? {}).filter(([, amount]) => Number(amount) > 0);
  return (
    <View style={styles.portfolioAccount}>
      <TouchableOpacity style={styles.portfolioHead} onPress={onPress} activeOpacity={0.78}>
        <View style={styles.portfolioIdentity}>
          <View style={styles.summaryIcon}><Ionicons name={icon} size={21} color={colors.gold} /></View>
          <View><Text style={styles.summaryTitle}>{title}</Text><Text style={styles.summaryCount}>{count.toLocaleString('en-US')} حساب نشط</Text></View>
        </View>
        <Ionicons name="chevron-back" size={20} color={colors.muted} />
      </TouchableOpacity>
      <View style={styles.balanceChips}>
        {debtorEntries.slice(0, 3).map(([currency, amount]) => (
          <TouchableOpacity key={`debtor-${currency}`} style={styles.balanceChip} onPress={() => onCurrencyPress(currency, 'debtor')} accessibilityLabel={`عرض ${title} بعملة ${currency} المدينة`}>
            <Text style={styles.summaryCurrency}>{currency}</Text>
            <Text style={styles.summaryAmount}>{formatBalance(Number(amount))}</Text>
            <Text style={styles.summaryLabelDebtor}>مدين · عليه</Text>
          </TouchableOpacity>
        ))}
        {creditorEntries.slice(0, 3).map(([currency, amount]) => (
          <TouchableOpacity key={`creditor-${currency}`} style={[styles.balanceChip, styles.creditChip]} onPress={() => onCurrencyPress(currency, 'creditor')} accessibilityLabel={`عرض ${title} بعملة ${currency} الدائنة`}>
            <Text style={styles.summaryCurrency}>{currency}</Text>
            <Text style={styles.summaryAmountCredit}>{formatBalance(Number(amount))}</Text>
            <Text style={styles.summaryLabelCreditor}>دائن · له</Text>
          </TouchableOpacity>
        ))}
        {!debtorEntries.length && !creditorEntries.length && <Text style={styles.emptyMini}>لا توجد أرصدة تشغيلية</Text>}
      </View>
    </View>
  );
}

function BalanceCompact({ balances }: { balances: unknown }) {
  const value = largestActionableDebtorBalance(balances);
  if (!value) return <Text style={styles.net}>صافي</Text>;
  return <View style={styles.compact}><Text style={styles.compactAmount}>{formatBalance(Number(value.balance ?? value.accountingBalance ?? 0))}</Text><Text style={styles.compactCurrency}>{value.currency || value.currencyCode}</Text></View>;
}

function NewDebtCard({ value, onPress }: { value: any | null; onPress: () => void }) {
  const entries = Object.entries(value?.perCurrency || {}) as [string, any][];
  return (
    <TouchableOpacity style={styles.debtChangeCard} onPress={onPress}>
      <View style={styles.debtChangeTitleRow}>
        <Ionicons name="swap-vertical-outline" size={20} color={colors.gold} />
        <View style={{ flex: 1 }}><Text style={styles.debtChangeTitle}>حركة المديونية — وارد ومنصرف</Text><Text style={styles.debtChangeSubtitle}>خلال آخر 24 ساعة؛ الوارد يزيد المديونية والمنصرف يخفضها</Text></View>
      </View>
      {!value && <Text style={styles.debtEmpty}>المؤشر غير متاح محليًا؛ حدّث المزامنة عند الاتصال.</Text>}
      {value && !entries.length && <Text style={styles.debtEmpty}>لا توجد حركات ضمن الحسابات المسموحة خلال آخر 24 ساعة.</Text>}
      <Text style={styles.debtEmpty}>من حركات المنصة وحركات Oracle المنشورة حسب وقت المستند، دون تكرار السندات. الزيادات والانخفاضات منفصلة حتى إن كان الصافي صفرًا.</Text>
      {entries.map(([currency, row]) => {
        const net = Number(row.netChange ?? row.amount ?? 0);
        return (
          <View key={currency} style={styles.debtCurrencyRow}>
            <View style={styles.debtNet}><Text style={[styles.debtNetValue, net < 0 && styles.debtDecrease]}>{formatBalance(Math.abs(net))}</Text><Text style={styles.debtCurrency}>{currency} · {net > 0 ? 'صافي زيادة' : net < 0 ? 'صافي انخفاض' : 'بدون تغير'}</Text></View>
            <View style={styles.debtDetail}><Text style={styles.debtIncrease}>وارد + {formatBalance(Number(row.positiveIncreases || 0))}</Text><Text style={styles.debtDecrease}>منصرف − {formatBalance(Number(row.decreases || 0))}</Text><Text style={styles.debtAffected}>{Number(row.affectedCount || 0).toLocaleString('en-US')} حساب</Text></View>
          </View>
        );
      })}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, content: { paddingBottom: 100 },
  header: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 25, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logo: { width: 115, height: 62 }, iconButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(255,255,255,.08)', alignItems: 'center', justifyContent: 'center' },
  greeting: { fontFamily: 'TajawalBold', color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'right', marginTop: 15 }, tagline: { fontFamily: 'TajawalRegular', color: '#B9CCC7', fontSize: 14, textAlign: 'right', marginTop: 4 },
  syncRow: { alignSelf: 'flex-end', marginTop: 16, flexDirection: 'row-reverse', gap: 6, alignItems: 'center', paddingVertical: 7, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,.08)', borderRadius: radius.pill },
  syncText: { fontFamily: 'TajawalBold', color: '#E4EEEB', fontSize: 13, fontWeight: '700' }, queueBadge: { fontFamily: 'TajawalBold', color: colors.primary, backgroundColor: colors.gold, borderRadius: 9, minWidth: 18, textAlign: 'center', fontWeight: '900', fontSize: 13 },
  quickGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', padding: 14, gap: 9 }, metric: { width: '48.5%', backgroundColor: '#fff', padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, ...shadow },
  metricIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' }, metricValue: { fontFamily: 'TajawalBold', fontSize: 28, fontWeight: '900', color: colors.ink, marginTop: 6, textAlign: 'right' }, metricLabel: { fontFamily: 'TajawalRegular', fontSize: 13, color: colors.muted, textAlign: 'right', marginTop: 2 },
  metricDetail: { fontFamily: 'TajawalRegular', fontSize: 12, color: colors.muted, textAlign: 'right', marginTop: 3 },
  reservationMetric:{marginHorizontal:14,marginBottom:10,padding:16,backgroundColor:'#fff',borderRadius:radius.md,borderWidth:1,borderColor:colors.line},reservationTitleRow:{alignItems:'flex-end'},reservationTons:{ fontFamily: 'TajawalBold',color:colors.primary,fontSize:13,fontWeight:'900',textAlign:'right',marginTop:7},reservationValue:{ fontFamily: 'TajawalBold',color:colors.warning,fontSize:13,fontWeight:'900',textAlign:'right',marginTop:2},
  customerAlertsCard: { marginHorizontal: 14, marginBottom: 5, padding: 13, borderRadius: radius.md, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, ...shadow },
  customerAlertsHeader: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }, customerAlertsTitle: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 15, fontWeight: '900', textAlign: 'right' }, customerAlertsSubtitle: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, marginTop: 2, textAlign: 'right' },
  customerAlertsRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 11 }, customerAlert: { flex: 1, minHeight: 64, borderRadius: radius.sm, padding: 10, alignItems: 'flex-end', justifyContent: 'center', borderWidth: 1 }, customerAlertWarning: { backgroundColor: '#FFF5F3', borderColor: '#F2D8D3' }, customerAlertNew: { backgroundColor: '#FFF9E8', borderColor: '#EEDC9A' }, customerAlertCount: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 23, fontWeight: '900' }, customerAlertLabel: { fontFamily: 'TajawalBold', color: colors.muted, fontSize: 13, fontWeight: '800', marginTop: 1 },
  neverFollowedCard: { marginHorizontal: 14, marginTop: 9, marginBottom: 5, padding: 13, borderRadius: radius.md, backgroundColor: '#FFF5F3', borderWidth: 1, borderColor: '#F2D8D3', flexDirection: 'row-reverse', alignItems: 'center', gap: 10, ...shadow },
  neverFollowedMain: { flex: 1, alignItems: 'flex-end' }, neverFollowedTitle: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 15, fontWeight: '900' }, neverFollowedSubtitle: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, marginTop: 2, textAlign: 'right' }, neverFollowedCount: { fontFamily: 'TajawalBold', color: colors.danger, fontSize: 23, fontWeight: '900' },
  sectionHeader: { paddingHorizontal: 17, marginTop: 11, marginBottom: 9 }, sectionTitle: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 18, fontWeight: '900', textAlign: 'right' }, sectionSubtitle: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, marginTop: 3, textAlign: 'right' },
  debtChangeCard: { marginHorizontal: 14, marginTop: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, ...shadow }, debtChangeTitleRow: { flexDirection: 'row-reverse', gap: 8, alignItems: 'center', marginBottom: 8 }, debtChangeTitle: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 16, fontWeight: '900', textAlign: 'right' }, debtChangeSubtitle: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, textAlign: 'right', marginTop: 2 }, debtEmpty: { fontFamily: 'TajawalRegular', color: colors.muted, backgroundColor: colors.background, borderRadius: radius.sm, padding: 10, fontSize: 13, textAlign: 'right' }, debtCurrencyRow: { paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, debtNet: { alignItems: 'flex-end' }, debtNetValue: { fontFamily: 'TajawalBold', color: colors.danger, fontSize: 18, fontWeight: '900' }, debtCurrency: { fontFamily: 'TajawalBold', color: colors.muted, fontSize: 13, fontWeight: '800' }, debtDetail: { alignItems: 'flex-start', gap: 2 }, debtIncrease: { fontFamily: 'TajawalBold', color: colors.danger, fontSize: 13, fontWeight: '800' }, debtDecrease: { fontFamily: 'TajawalBold', color: colors.success, fontSize: 13, fontWeight: '800' }, debtAffected: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13 },
  debtorRule: { alignSelf: 'flex-end', marginHorizontal: 14, marginBottom: 7, paddingVertical: 6, paddingHorizontal: 9, backgroundColor: colors.primarySoft, borderRadius: radius.pill, flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }, debtorRuleText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 13, fontWeight: '800' },
  portfolioCard: { marginHorizontal: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, overflow: 'hidden', ...shadow },
  portfolioDivider: { height: 1, backgroundColor: colors.line, marginHorizontal: 14 },
  portfolioAccount: { padding: 14 },
  portfolioHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  portfolioIdentity: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9 },
  summaryIcon: { width: 39, height: 39, borderRadius: 13, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: `${colors.gold}80`, alignItems: 'center', justifyContent: 'center' },
  summaryTitle: { fontFamily: 'TajawalBold', color: colors.ink, fontWeight: '900', fontSize: 16, textAlign: 'right' },
  summaryCount: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, textAlign: 'right', marginTop: 2 },
  balanceChips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 7, marginTop: 11 },
  balanceChip: { minWidth: '30%', flexGrow: 1, backgroundColor: '#FFF5F3', borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 8, alignItems: 'flex-end', borderWidth: 1, borderColor: '#F2D8D3' },
  creditChip: { backgroundColor: '#EFF9F4', borderColor: '#CDE8DA' },
  summaryAmount: { fontFamily: 'TajawalBold', color: colors.danger, fontSize: 15, fontWeight: '900', marginTop: 1 }, summaryAmountCredit: { fontFamily: 'TajawalBold', color: colors.success, fontSize: 15, fontWeight: '900', marginTop: 1 }, summaryLabelDebtor: { fontFamily: 'TajawalBold', color: colors.danger, fontSize: 13, fontWeight: '800' }, summaryLabelCreditor: { fontFamily: 'TajawalBold', color: colors.success, fontSize: 13, fontWeight: '800' }, summaryCurrency: { fontFamily: 'TajawalBold', color: colors.muted, fontSize: 13, fontWeight: '900' }, emptyMini: { fontFamily: 'TajawalBold', color: colors.success, fontSize: 13, fontWeight: '800', paddingVertical: 6 },
  priorityCard: { marginHorizontal: 14, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }, priorityRow: { minHeight: 69, padding: 12, flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }, priorityBorder: { borderTopWidth: 1, borderTopColor: colors.line }, rank: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' }, rankText: { fontFamily: 'TajawalBold', fontSize: 15, color: colors.warning, fontWeight: '900' }, priorityMain: { flex: 1 }, priorityName: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 14, fontWeight: '800', textAlign: 'right' }, priorityMeta: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, marginTop: 3, textAlign: 'right' }, priorityCollector: { fontFamily: 'TajawalBold', color: colors.secondary, fontSize: 13, fontWeight: '800', marginTop: 2, textAlign: 'right' }, compact: { alignItems: 'flex-start' }, compactAmount: { fontFamily: 'TajawalBold', color: colors.danger, fontWeight: '900', fontSize: 14 }, compactCurrency: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13 }, net: { fontFamily: 'TajawalBold', color: colors.success, fontWeight: '800', fontSize: 13 }, empty: { color: colors.muted, padding: 25, textAlign: 'center' },
});
