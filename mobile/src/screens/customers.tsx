import React from 'react';
import {
  FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getAll } from '../db/database';
import Loading from '../components/loading';
import { colors, radius, shadow } from '../theme';
import { useAuth } from '../store/auth-context';
import {
  BalanceSide, canonicalCurrencyCode, customerEngagementIds, formatBalance, hasNoRecordedFollowup,
  isActionableBalance, isBalanceForCurrencySide, isSignificantBalance, parseBalances, searchableCustomerText, totalActionableDebtorBalance,
  totalBalanceForCurrencySide, totalSignificantBalance,
} from '../utils/customer';
import { matchesSmartSearch } from '../utils/search';

type AccountKind = 'customer' | 'advance';
type SortMode = 'name' | 'balance' | 'recent';

export default function CustomersScreen(props: any) {
  return <AccountsScreen {...props} kind="customer" />;
}

export function AccountsScreen({ navigation, route, kind }: { navigation: any; route?: any; kind: AccountKind }) {
  const [accounts, setAccounts] = React.useState<any[]>([]);
  const [engagedCustomerIds, setEngagedCustomerIds] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState<SortMode>('balance');
  const [loading, setLoading] = React.useState(true);
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const showCollector = permissions.includes('customers.read_all');
  const deliveryDirectory = permissions.includes('mobile.delivery.customers.view_all_no_balance') && !showCollector;
  const currencyFilter = route?.params?.currencyFilter
    ? canonicalCurrencyCode(route.params.currencyFilter)
    : '';
  const balanceSide: BalanceSide = kind === 'advance' && route?.params?.balanceSide === 'creditor'
    ? 'creditor'
    : 'debtor';
  const alertFilter: '' | 'unassigned' | 'new' | 'never_followed' = route?.params?.alertFilter === 'unassigned'
    ? 'unassigned'
    : route?.params?.alertFilter === 'new' ? 'new'
      : route?.params?.alertFilter === 'never_followed' ? 'never_followed' : '';
  const createdSince = String(route?.params?.createdSince || '');

  React.useEffect(() => {
    if (alertFilter === 'new') setSort('recent');
  }, [alertFilter]);

  useFocusEffect(React.useCallback(() => {
    let active = true;
    Promise.all([getAll('customers'), getAll('followups')])
      .then(([rows, followups]) => {
      if (active) {
        setAccounts(rows);
        setEngagedCustomerIds(customerEngagementIds(followups.filter((f:any) => !f.deletedAt)));
      }
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []));

  const visible = React.useMemo(() => {
    const query = search.trim();
    const seen = new Set<string>();
    const result = accounts.filter((account) => {
      if (!account?.id || seen.has(account.id)) return false;
      seen.add(account.id);
      const isAdvance = account.customerType === 'advance';
      if ((kind === 'advance') !== isAdvance) return false;
      if (alertFilter === 'unassigned' && account.assignedCollectorName) return false;
      if (alertFilter === 'new' && (!createdSince || String(account.createdAt || '') < createdSince)) return false;
      if (alertFilter === 'never_followed' && (!account.assignedCollectorName
        || !hasNoRecordedFollowup(account, engagedCustomerIds))) return false;
      if (query && !matchesSmartSearch(searchableCustomerText(account), query)) return false;
      if (currencyFilter && totalBalanceForCurrencySide(account.balances, currencyFilter, balanceSide) <= 0) return false;
      const visibleBalance = kind === 'advance'
        ? totalSignificantBalance(account.balances)
        : totalActionableDebtorBalance(account.balances);
      return deliveryDirectory || Boolean(query) || visibleBalance > 0.001;
    });
    return result.sort((a, b) => {
      if (!deliveryDirectory && sort === 'balance') {
        if (currencyFilter) {
          return totalBalanceForCurrencySide(b.balances, currencyFilter, balanceSide)
            - totalBalanceForCurrencySide(a.balances, currencyFilter, balanceSide);
        }
        const amount = kind === 'advance' ? totalSignificantBalance : totalActionableDebtorBalance;
        return amount(b.balances) - amount(a.balances);
      }
      if (sort === 'recent') return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      return String(a.fullName || '').localeCompare(String(b.fullName || ''), 'ar');
    });
  }, [accounts, alertFilter, balanceSide, createdSince, currencyFilter, deliveryDirectory, engagedCustomerIds, kind, search, sort]);

  const renderAccount = React.useCallback(({ item }: { item: any }) => (
    <AccountRow
      account={item}
      kind={kind}
      showCollector={showCollector}
      hideBalances={Boolean(item.balanceHidden)}
      currencyFilter={currencyFilter}
      balanceSide={balanceSide}
      navigation={navigation}
    />
  ), [balanceSide, currencyFilter, kind, navigation, showCollector]);

  if (loading) return <Loading />;
  const title = kind === 'advance' ? 'حسابات السلف' : 'العملاء';

  return (
    <View style={styles.screen}>
      <View style={styles.hero}>
        <View>
          <Text style={styles.eyebrow}>الراقي</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.count}>{visible.length.toLocaleString('en-US')} حساب{currencyFilter ? ` · ${currencyFilter} ${balanceSide === 'creditor' ? 'دائن · له' : 'مدين · عليه'}` : ''}</Text>
        </View>
        <View style={styles.heroIcon}>
          <Ionicons name={kind === 'advance' ? 'wallet-outline' : 'people-outline'} size={27} color={colors.gold} />
        </View>
      </View>

      {!!currencyFilter && <View style={styles.activeCurrencyFilter}>
        <TouchableOpacity
          style={styles.clearCurrencyFilter}
          onPress={() => navigation.setParams({ currencyFilter: undefined, balanceSide: undefined })}
          accessibilityLabel="إلغاء مرشح العملة"
        ><Ionicons name="close" size={16} color={colors.primary} /></TouchableOpacity>
        <Text style={styles.activeCurrencyText}>يعرض حسابات {currencyFilter} {balanceSide === 'creditor' ? 'الدائنة' : 'المدينة'} فقط</Text>
        <Ionicons name="filter" size={16} color={colors.gold} />
      </View>}
      {!!alertFilter && <View style={styles.activeCurrencyFilter}>
        <TouchableOpacity style={styles.clearCurrencyFilter} onPress={() => navigation.setParams({ alertFilter: undefined, createdSince: undefined })} accessibilityLabel="إلغاء مرشح التنبيه"><Ionicons name="close" size={16} color={colors.primary} /></TouchableOpacity>
        <Text style={styles.activeCurrencyText}>{alertFilter === 'unassigned' ? 'يعرض العملاء دون محصّل فقط' : alertFilter === 'never_followed' ? 'لم تُسجّل أي متابعة لهذه الحسابات' : 'يعرض العملاء الجدد خلال آخر 7 أيام'}</Text>
        <Ionicons name={alertFilter === 'unassigned' ? 'alert-circle-outline' : alertFilter === 'never_followed' ? 'person-remove-outline' : 'sparkles-outline'} size={16} color={colors.gold} />
      </View>}

      <View style={styles.searchBox}>
        <Ionicons name="search" size={21} color={colors.muted} />
        <TextInput
          style={styles.searchInput}
          placeholder="الاسم، رقم الهاتف أو كود العميل"
          placeholderTextColor="#879692"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
        {!!search && (
          <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="مسح البحث">
            <Ionicons name="close-circle" size={20} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filters}>
        {!deliveryDirectory && <Filter label="أعلى رصيد" active={sort === 'balance'} onPress={() => setSort('balance')} />}
        <Filter label="الاسم" active={sort === 'name'} onPress={() => setSort('name')} />
        <Filter label="الأحدث" active={sort === 'recent'} onPress={() => setSort('recent')} />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        removeClippedSubviews
        renderItem={renderAccount}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={38} color={colors.gold} />
            <Text style={styles.emptyTitle}>لا توجد نتائج مطابقة</Text>
            <Text style={styles.emptyText}>جرّب الاسم أو الهاتف أو كود الحساب</Text>
          </View>
        )}
      />
    </View>
  );
}

function Filter({ label, icon, active, onPress }: { label: string; icon?: keyof typeof Ionicons.glyphMap; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.filter, active && styles.filterActive]} onPress={onPress}>
      {!!icon && <Ionicons name={icon} size={14} color={active ? '#fff' : colors.muted} />}
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const AccountRow = React.memo(function AccountRow({ account, kind, showCollector, hideBalances, currencyFilter, balanceSide, navigation }: { account: any; kind: AccountKind; showCollector: boolean; hideBalances: boolean; currencyFilter: string; balanceSide: BalanceSide; navigation: any }) {
  const balances = parseBalances(account.balances).filter((balance) => currencyFilter
    ? isBalanceForCurrencySide(balance, currencyFilter, balanceSide)
    : (kind === 'advance' ? isSignificantBalance(balance) : isActionableBalance(balance)));
  const code = account.externalCustomerCode || account.accountNumber || '—';
  return (
    <TouchableOpacity style={styles.account} onPress={() => navigation.navigate('Customer360', { id: String(account.id), customer: account })} activeOpacity={0.75}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{String(account.fullName || '?').trim().charAt(0)}</Text></View>
      <View style={styles.accountMain}>
        <Text style={styles.accountName} numberOfLines={2}>{account.fullName || 'بدون اسم'}</Text>
        {showCollector && (
          <Text style={styles.collectorName} numberOfLines={1}>
            المحصّل: {account.assignedCollectorName || 'غير مسند'}
          </Text>
        )}
        <View style={styles.metaRow}>
          <Text style={styles.code}>#{code}</Text>
          {!!account.phonePrimary && <Text style={styles.phone}>{account.phonePrimary}</Text>}
        </View>
      </View>
      {!hideBalances && <View style={styles.balanceStack}>
        {balances.length ? balances.slice(0, 2).map((balance, index) => (
          <View key={`${balance.currency || balance.currencyCode}-${index}`} style={styles.balanceLine}>
            <Text style={[styles.balanceAmount, Number(balance.balance ?? balance.accountingBalance ?? 0) < 0 && styles.creditBalance]}>{formatBalance(Math.abs(Number(balance.balance ?? balance.accountingBalance ?? 0)))}</Text>
            <Text style={styles.currency}>{balance.currency || balance.currencyCode}</Text>
            {kind === 'advance' && <Text style={[styles.balanceSide, Number(balance.balance ?? balance.accountingBalance ?? 0) < 0 && styles.creditBalance]}> {Number(balance.balance ?? balance.accountingBalance ?? 0) < 0 ? 'دائن · له' : 'مدين · عليه'}</Text>}
          </View>
        )) : <Text style={styles.zero}>صافي</Text>}
        <Ionicons name="chevron-back" size={17} color={colors.muted} />
      </View>}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  hero: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { fontFamily: 'TajawalBold', color: colors.gold, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  title: { fontFamily: 'TajawalBold', color: '#fff', fontSize: 25, fontWeight: '800', textAlign: 'right', marginTop: 2 },
  count: { fontFamily: 'TajawalRegular', color: '#B9CCC7', fontSize: 13, marginTop: 4, textAlign: 'right' },
  heroIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: 'rgba(255,255,255,.08)', alignItems: 'center', justifyContent: 'center' },
  activeCurrencyFilter: { marginHorizontal: 14, marginTop: 11, paddingHorizontal: 12, minHeight: 42, borderRadius: radius.pill, backgroundColor: colors.primarySoft, flexDirection: 'row-reverse', alignItems: 'center', gap: 7 },
  activeCurrencyText: { fontFamily: 'TajawalBold', flex: 1, color: colors.primary, textAlign: 'right', fontSize: 13, fontWeight: '900' },
  clearCurrencyFilter: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  searchBox: { margin: 14, marginBottom: 8, height: 52, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, flexDirection: 'row-reverse', alignItems: 'center', paddingHorizontal: 14, gap: 9, ...shadow },
  searchInput: { fontFamily: 'TajawalRegular', flex: 1, color: colors.ink, fontSize: 16, textAlign: 'right', paddingVertical: 0 },
  filters: { flexDirection: 'row-reverse', paddingHorizontal: 14, paddingBottom: 10, gap: 7 },
  filter: { flex: 1, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', flexDirection: 'row-reverse', gap: 3 },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { fontFamily: 'TajawalBold', fontSize: 13, color: colors.muted, fontWeight: '700' },
  filterTextActive: { color: '#fff' },
  list: { padding: 14, paddingTop: 2, paddingBottom: 110 },
  account: { minHeight: 88, padding: 13, marginBottom: 9, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, flexDirection: 'row-reverse', alignItems: 'center', gap: 11 },
  avatar: { width: 45, height: 45, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 20, fontWeight: '900' },
  accountMain: { flex: 1 },
  accountName: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: '800', textAlign: 'right' },
  collectorName: { fontFamily: 'TajawalBold', color: colors.secondary, fontSize: 13, fontWeight: '800', textAlign: 'right', marginTop: 2 },
  metaRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 5, alignItems: 'center' },
  code: { fontFamily: 'TajawalBold', color: colors.warning, fontSize: 13, fontWeight: '800' },
  phone: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13 },
  balanceStack: { minWidth: 96, alignItems: 'flex-start', gap: 3 },
  balanceLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  balanceAmount: { fontFamily: 'TajawalBold', color: colors.danger, fontSize: 14, fontWeight: '900' },
  creditBalance: { color: colors.success },
  balanceSide: { fontFamily: 'TajawalBold', color: colors.danger, fontSize: 13, fontWeight: '800' },
  currency: { fontFamily: 'TajawalBold', color: colors.muted, fontSize: 13, fontWeight: '800' },
  zero: { fontFamily: 'TajawalBold', color: colors.success, fontWeight: '800', fontSize: 13 },
  empty: { alignItems: 'center', paddingTop: 70 },
  emptyTitle: { fontFamily: 'TajawalBold', marginTop: 13, color: colors.ink, fontSize: 18, fontWeight: '800' },
  emptyText: { fontFamily: 'TajawalRegular', marginTop: 5, color: colors.muted, fontSize: 14 },
});
