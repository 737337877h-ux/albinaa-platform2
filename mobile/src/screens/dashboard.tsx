import React from 'react';
import {
  Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../store/auth-context';
import { useSync } from '../store/sync-context';
import { getAll } from '../db/database';
import { colors, radius, shadow } from '../theme';
import { formatBalance, parseBalances, totalAbsoluteBalance, totalsByCurrency } from '../utils/customer';
import brandImage from '../../assets/alraqi-brand.png';

export default function DashboardScreen({ navigation }: any) {
  const { user } = useAuth();
  const { status, triggerSync } = useSync();
  const [data, setData] = React.useState<{ tasks: any[]; collections: any[]; customers: any[]; followups: any[] }>({ tasks: [], collections: [], customers: [], followups: [] });

  const load = React.useCallback(async () => {
    const [tasks, collections, customers, followups] = await Promise.all([
      getAll('tasks'), getAll('collections'), getAll('customers'), getAll('followups'),
    ]);
    setData({ tasks, collections, customers, followups });
  }, []);

  useFocusEffect(React.useCallback(() => { load(); }, [load]));
  const today = localDateKey(new Date());
  const customerAccounts = data.customers.filter((c) => c.customerType !== 'advance');
  const advances = data.customers.filter((c) => c.customerType === 'advance');
  const todayTasks = data.tasks.filter((task) => String(task.dueDate || '').slice(0, 10) === today && task.status !== 'completed');
  const overdue = data.tasks.filter((task) => task.dueDate && String(task.dueDate).slice(0, 10) < today && task.status !== 'completed');
  const todayCollections = data.collections.filter((item) => item.collectedAt && localDateKey(new Date(item.collectedAt)) === today);
  // Match the web dashboard definition of debt: positive debtor balances only.
  // Customer credit balances are reported separately and do not reduce debt.
  const customerTotals = totalsByCurrency(customerAccounts, true);
  const advanceTotals = totalsByCurrency(advances);
  const priorities = [...customerAccounts, ...advances]
    .filter((account) => totalAbsoluteBalance(account.balances) > 0)
    .sort((a, b) => totalAbsoluteBalance(b.balances) - totalAbsoluteBalance(a.balances)).slice(0, 5);

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
          <Image source={brandImage} style={styles.logo} />
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
        <Metric icon="checkbox-outline" label="مهام اليوم" value={todayTasks.length} tone="green" onPress={() => navigation.navigate('Tasks')} />
        <Metric icon="alert-circle-outline" label="متأخرة" value={overdue.length} tone="red" onPress={() => navigation.navigate('Tasks')} />
        <Metric icon="cash-outline" label="تحصيلات اليوم" value={todayCollections.length} tone="gold" onPress={() => navigation.navigate('CollectionsList')} />
        <Metric icon="cloud-upload-outline" label="بانتظار المزامنة" value={status.pending} tone="neutral" onPress={() => navigation.navigate('Settings')} />
      </View>

      <SectionHeader title="محفظة المديونية" subtitle="الأرصدة حسب العملة ونوع الحساب" />
      <View style={styles.portfolioRow}>
        <BalanceSummary title="العملاء" count={customerAccounts.length} totals={customerTotals} icon="people-outline" onPress={() => navigation.navigate('Customers')} />
        <BalanceSummary title="السلف" count={advances.length} totals={advanceTotals} icon="wallet-outline" onPress={() => navigation.navigate('Advances')} />
      </View>

      <SectionHeader title="أولوية التواصل" subtitle="أعلى الحسابات رصيداً في نطاق إسنادك" />
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
              <Text style={styles.priorityMeta}>{account.customerType === 'advance' ? 'سلفة' : 'عميل'} · #{account.accountNumber || account.externalCustomerCode || '—'}</Text>
            </View>
            <BalanceCompact balances={account.balances} />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

function Metric({ icon, label, value, tone, onPress }: any) {
  const toneStyle: any = { green: colors.success, red: colors.danger, gold: colors.warning, neutral: colors.secondary };
  return (
    <TouchableOpacity style={styles.metric} onPress={onPress}>
      <View style={[styles.metricIcon, { backgroundColor: `${toneStyle[tone]}16` }]}><Ionicons name={icon} size={21} color={toneStyle[tone]} /></View>
      <Text style={styles.metricValue}>{Number(value).toLocaleString('en-US')}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionSubtitle}>{subtitle}</Text></View>;
}

function BalanceSummary({ title, count, totals, icon, onPress }: any) {
  return (
    <TouchableOpacity style={styles.balanceSummary} onPress={onPress}>
      <View style={styles.summaryTitleRow}><View style={styles.summaryIcon}><Ionicons name={icon} size={20} color={colors.gold} /></View><Text style={styles.summaryTitle}>{title}</Text></View>
      <Text style={styles.summaryCount}>{count.toLocaleString('en-US')} حساب</Text>
      {Object.entries(totals).slice(0, 3).map(([currency, amount]) => (
        <View key={currency} style={styles.summaryBalance}><Text style={styles.summaryAmount}>{formatBalance(Number(amount))}</Text><Text style={styles.summaryCurrency}>{currency}</Text></View>
      ))}
      {!Object.keys(totals).length && <Text style={styles.emptyMini}>لا أرصدة</Text>}
    </TouchableOpacity>
  );
}

function BalanceCompact({ balances }: { balances: unknown }) {
  const value = parseBalances(balances).sort((a, b) => Math.abs(Number(b.balance || 0)) - Math.abs(Number(a.balance || 0)))[0];
  if (!value) return <Text style={styles.net}>صافي</Text>;
  return <View style={styles.compact}><Text style={styles.compactAmount}>{formatBalance(Number(value.balance ?? value.accountingBalance ?? 0))}</Text><Text style={styles.compactCurrency}>{value.currency || value.currencyCode}</Text></View>;
}

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, content: { paddingBottom: 100 },
  header: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 25, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logo: { width: 55, height: 55, borderRadius: 15 }, iconButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(255,255,255,.08)', alignItems: 'center', justifyContent: 'center' },
  greeting: { color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'right', marginTop: 15 }, tagline: { color: '#B9CCC7', fontSize: 13, textAlign: 'right', marginTop: 4 },
  syncRow: { alignSelf: 'flex-end', marginTop: 16, flexDirection: 'row-reverse', gap: 6, alignItems: 'center', paddingVertical: 7, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,.08)', borderRadius: radius.pill },
  syncText: { color: '#E4EEEB', fontSize: 11, fontWeight: '700' }, queueBadge: { color: colors.primary, backgroundColor: colors.gold, borderRadius: 9, minWidth: 18, textAlign: 'center', fontWeight: '900', fontSize: 10 },
  quickGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', padding: 14, gap: 9 }, metric: { width: '48.5%', backgroundColor: '#fff', padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, ...shadow },
  metricIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' }, metricValue: { fontSize: 27, fontWeight: '900', color: colors.ink, marginTop: 6, textAlign: 'right' }, metricLabel: { fontSize: 12, color: colors.muted, textAlign: 'right', marginTop: 2 },
  sectionHeader: { paddingHorizontal: 17, marginTop: 11, marginBottom: 9 }, sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '900', textAlign: 'right' }, sectionSubtitle: { color: colors.muted, fontSize: 11, marginTop: 3, textAlign: 'right' },
  portfolioRow: { flexDirection: 'row-reverse', paddingHorizontal: 14, gap: 9 }, balanceSummary: { flex: 1, minHeight: 150, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14 },
  summaryTitleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 7 }, summaryIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, summaryTitle: { color: colors.ink, fontWeight: '900', fontSize: 15 }, summaryCount: { color: colors.muted, fontSize: 10, textAlign: 'right', marginVertical: 8 },
  summaryBalance: { flexDirection: 'row', alignItems: 'baseline', gap: 4, justifyContent: 'flex-start', marginTop: 3 }, summaryAmount: { color: colors.danger, fontSize: 15, fontWeight: '900' }, summaryCurrency: { color: colors.muted, fontSize: 9, fontWeight: '800' }, emptyMini: { color: colors.success, fontSize: 12, fontWeight: '800' },
  priorityCard: { marginHorizontal: 14, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }, priorityRow: { minHeight: 69, padding: 12, flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }, priorityBorder: { borderTopWidth: 1, borderTopColor: colors.line }, rank: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' }, rankText: { color: colors.warning, fontWeight: '900' }, priorityMain: { flex: 1 }, priorityName: { color: colors.ink, fontSize: 13, fontWeight: '800', textAlign: 'right' }, priorityMeta: { color: colors.muted, fontSize: 10, marginTop: 3, textAlign: 'right' }, compact: { alignItems: 'flex-start' }, compactAmount: { color: colors.danger, fontWeight: '900', fontSize: 13 }, compactCurrency: { color: colors.muted, fontSize: 9 }, net: { color: colors.success, fontWeight: '800', fontSize: 11 }, empty: { color: colors.muted, padding: 25, textAlign: 'center' },
});
