import React from 'react';
import {
  FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getAll } from '../db/database';
import Loading from '../components/loading';
import { colors, radius, shadow } from '../theme';
import {
  formatBalance, parseBalances, searchableCustomerText, totalAbsoluteBalance,
} from '../utils/customer';

type AccountKind = 'customer' | 'advance';
type SortMode = 'name' | 'balance' | 'recent';

export default function CustomersScreen(props: any) {
  return <AccountsScreen {...props} kind="customer" />;
}

export function AccountsScreen({ navigation, kind }: { navigation: any; kind: AccountKind }) {
  const [accounts, setAccounts] = React.useState<any[]>([]);
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState<SortMode>('balance');
  const [onlyWithBalance, setOnlyWithBalance] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  useFocusEffect(React.useCallback(() => {
    let active = true;
    getAll('customers').then((rows) => {
      if (active) setAccounts(rows);
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []));

  const visible = React.useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ar');
    const seen = new Set<string>();
    const result = accounts.filter((account) => {
      if (!account?.id || seen.has(account.id)) return false;
      seen.add(account.id);
      const isAdvance = account.customerType === 'advance';
      if ((kind === 'advance') !== isAdvance) return false;
      if (query && !searchableCustomerText(account).includes(query)) return false;
      return !onlyWithBalance || totalAbsoluteBalance(account.balances) > 0.001;
    });
    return result.sort((a, b) => {
      if (sort === 'balance') return totalAbsoluteBalance(b.balances) - totalAbsoluteBalance(a.balances);
      if (sort === 'recent') return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      return String(a.fullName || '').localeCompare(String(b.fullName || ''), 'ar');
    });
  }, [accounts, kind, onlyWithBalance, search, sort]);

  if (loading) return <Loading />;
  const title = kind === 'advance' ? 'حسابات السلف' : 'العملاء';

  return (
    <View style={styles.screen}>
      <View style={styles.hero}>
        <View>
          <Text style={styles.eyebrow}>الراقي</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.count}>{visible.length.toLocaleString('en-US')} حساب</Text>
        </View>
        <View style={styles.heroIcon}>
          <Ionicons name={kind === 'advance' ? 'wallet-outline' : 'people-outline'} size={27} color={colors.gold} />
        </View>
      </View>

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
        <Filter label="أعلى رصيد" active={sort === 'balance'} onPress={() => setSort('balance')} />
        <Filter label="الاسم" active={sort === 'name'} onPress={() => setSort('name')} />
        <Filter label="الأحدث" active={sort === 'recent'} onPress={() => setSort('recent')} />
        <Filter label="له رصيد" active={onlyWithBalance} onPress={() => setOnlyWithBalance((v) => !v)} />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={15}
        windowSize={7}
        removeClippedSubviews
        renderItem={({ item }) => (
          <AccountRow
            account={item}
            onPress={() => navigation.navigate('Customer360', { id: String(item.id), customer: item })}
          />
        )}
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

function Filter({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.filter, active && styles.filterActive]} onPress={onPress}>
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function AccountRow({ account, onPress }: { account: any; onPress: () => void }) {
  const balances = parseBalances(account.balances).filter((b) => Math.abs(Number(b.balance ?? b.accountingBalance ?? 0)) > 0.001);
  const code = account.accountNumber || account.externalCustomerCode || '—';
  return (
    <TouchableOpacity style={styles.account} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{String(account.fullName || '?').trim().charAt(0)}</Text></View>
      <View style={styles.accountMain}>
        <Text style={styles.accountName} numberOfLines={2}>{account.fullName || 'بدون اسم'}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.code}>#{code}</Text>
          {!!account.phonePrimary && <Text style={styles.phone}>{account.phonePrimary}</Text>}
        </View>
      </View>
      <View style={styles.balanceStack}>
        {balances.length ? balances.slice(0, 2).map((balance, index) => (
          <View key={`${balance.currency || balance.currencyCode}-${index}`} style={styles.balanceLine}>
            <Text style={styles.balanceAmount}>{formatBalance(Number(balance.balance ?? balance.accountingBalance ?? 0))}</Text>
            <Text style={styles.currency}>{balance.currency || balance.currencyCode}</Text>
          </View>
        )) : <Text style={styles.zero}>صافي</Text>}
        <Ionicons name="chevron-back" size={17} color={colors.muted} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  hero: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: colors.gold, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  title: { color: '#fff', fontSize: 25, fontWeight: '800', textAlign: 'right', marginTop: 2 },
  count: { color: '#B9CCC7', fontSize: 12, marginTop: 4, textAlign: 'right' },
  heroIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: 'rgba(255,255,255,.08)', alignItems: 'center', justifyContent: 'center' },
  searchBox: { margin: 14, marginBottom: 8, height: 52, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, flexDirection: 'row-reverse', alignItems: 'center', paddingHorizontal: 14, gap: 9, ...shadow },
  searchInput: { flex: 1, color: colors.ink, fontSize: 15, textAlign: 'right', paddingVertical: 0 },
  filters: { flexDirection: 'row-reverse', paddingHorizontal: 14, paddingBottom: 10, gap: 7 },
  filter: { flex: 1, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center' },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { fontSize: 11, color: colors.muted, fontWeight: '700' },
  filterTextActive: { color: '#fff' },
  list: { padding: 14, paddingTop: 2, paddingBottom: 110 },
  account: { minHeight: 88, padding: 13, marginBottom: 9, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, flexDirection: 'row-reverse', alignItems: 'center', gap: 11 },
  avatar: { width: 45, height: 45, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontSize: 19, fontWeight: '900' },
  accountMain: { flex: 1 },
  accountName: { color: colors.ink, fontSize: 15, lineHeight: 22, fontWeight: '800', textAlign: 'right' },
  metaRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 5, alignItems: 'center' },
  code: { color: colors.warning, fontSize: 12, fontWeight: '800' },
  phone: { color: colors.muted, fontSize: 11 },
  balanceStack: { minWidth: 96, alignItems: 'flex-start', gap: 3 },
  balanceLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  balanceAmount: { color: colors.danger, fontSize: 13, fontWeight: '900' },
  currency: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  zero: { color: colors.success, fontWeight: '800', fontSize: 12 },
  empty: { alignItems: 'center', paddingTop: 70 },
  emptyTitle: { marginTop: 13, color: colors.ink, fontSize: 17, fontWeight: '800' },
  emptyText: { marginTop: 5, color: colors.muted, fontSize: 13 },
});
