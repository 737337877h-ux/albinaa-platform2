import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getAll } from '../db/database';
import { colors, radius, shadow } from '../theme';

export default function CollectionsListScreen({ navigation }: any) {
  const [localCollections, setLocalCollections] = useState<any[]>([]);

  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        setLocalCollections(await getAll('collections'));
      })();
    }, []),
  );

  const seen = new Set<string>();
  const all: any[] = [];
  for (const c of localCollections) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    all.push(c);
  }
  all.sort((a, b) => (b.collectedAt || b.updatedAt || '').localeCompare(a.collectedAt || a.updatedAt || ''));

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayCollections = all.filter((c) => {
    if (!c.collectedAt) return false;
    const date = new Date(c.collectedAt);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` === today;
  });
  const todayTotal = todayCollections.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const todayIds = new Set(todayCollections.map((c) => c.id));
  const recentCollections = all.filter((c) => !todayIds.has(c.id)).slice(0, 50);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>التحصيلات</Text>
          <Text style={styles.subtitle}>اليوم: {todayCollections.length} | إجمالي اليوم: {todayTotal.toLocaleString('en-US')}</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('NewCollection')}>
          <Text style={styles.addBtnText}>+ تحصيل</Text>
        </TouchableOpacity>
      </View>

      {todayCollections.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>تحصيلات اليوم</Text>
          <FlatList
            data={todayCollections}
            keyExtractor={(item) => `today-${item.id}`}
            renderItem={({ item }) => <CollectionItem item={item} navigation={navigation} />}
          />
        </>
      )}

      <Text style={styles.sectionTitle}>التحصيلات السابقة</Text>
      {recentCollections.length === 0 ? (
        <Text style={styles.empty}>لا توجد تحصيلات سابقة</Text>
      ) : (
        <FlatList
          data={recentCollections}
          keyExtractor={(item) => `prev-${item.id}`}
          renderItem={({ item }) => <CollectionItem item={item} navigation={navigation} />}
        />
      )}
    </View>
  );
}

function CollectionItem({ item, navigation }: { item: any; navigation: any }) {
  return (
    <TouchableOpacity
      style={styles.item}
      onPress={() => item.customerId && navigation.navigate('Customer360', { id: item.customerId })}
    >
      <View style={styles.itemHeader}>
        <Text style={styles.itemTitle}>{item.customerName || 'عميل'}</Text>
        <Text style={styles.itemAmount}>
          {Number(item.amount || 0).toLocaleString('en-US')} {item.currencyCode || ''}
        </Text>
      </View>
      <View style={styles.itemRow}>
        <Text style={styles.itemDate}>
          {item.collectedAt ? new Date(item.collectedAt).toLocaleDateString('ar-SA') : ''}
        </Text>
        {!!item.methodName && <Text style={styles.itemMethod}>طريقة: {item.methodName}</Text>}
      </View>
      {!!item.notes && <Text style={styles.itemNotes}>{item.notes}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18, backgroundColor: colors.primary, borderBottomWidth: 2, borderBottomColor: colors.gold },
  title: { fontSize: 21, fontWeight: '900', color: colors.background },
  subtitle: { fontSize: 12, color: colors.background, marginTop: 4, opacity: 0.85 },
  addBtn: { backgroundColor: colors.gold, paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.pill },
  addBtnText: { color: colors.primary, fontWeight: '900' },
  sectionTitle: { fontSize: 16, fontWeight: '900', color: colors.ink, padding: 16, paddingBottom: 8, textAlign: 'right' },
  item: { backgroundColor: colors.surface, marginHorizontal: 16, marginBottom: 10, padding: 15, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, ...shadow },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemTitle: { fontSize: 16, color: colors.ink, fontWeight: '800', flex: 1, textAlign: 'right' },
  itemAmount: { fontSize: 16, color: colors.goldDark, fontWeight: '900' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  itemDate: { fontSize: 12, color: colors.muted },
  itemMethod: { fontSize: 12, color: colors.muted },
  itemNotes: { fontSize: 13, color: colors.ink, marginTop: 6, fontStyle: 'italic', textAlign: 'right' },
  empty: { textAlign: 'center', color: colors.muted, padding: 30 },
});
