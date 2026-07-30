import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { getAll, getMeta } from '../db/database';
import { fetchSync as fetchSyncApi } from '../api/endpoints';
import Loading from '../components/loading';

export default function CollectionsListScreen({ navigation }: any) {
  const [localCollections, setLocalCollections] = useState<any[]>([]);

  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        setLocalCollections(await getAll('collections'));
      })();
    }, []),
  );

  const { data: syncData, isLoading } = useQuery({
    queryKey: ['sync-collections'],
    queryFn: async () => {
      const token = await getMeta('syncToken');
      const res = await fetchSyncApi(token || undefined);
      return res.data;
    },
  });

  if (isLoading && !syncData) return <Loading />;

  const remoteCollections = syncData?.collections || [];
  const seen = new Set<string>();
  const all: any[] = [];
  for (const c of [...localCollections, ...remoteCollections]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    all.push(c);
  }
  all.sort((a, b) => (b.collectedAt || b.updatedAt || '').localeCompare(a.collectedAt || a.updatedAt || ''));

  const today = new Date().toISOString().split('T')[0];
  const todayCollections = all.filter((c) => c.collectedAt?.startsWith(today));
  const todayTotal = todayCollections.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const recentCollections = all.filter((c) => !c.collectedAt?.startsWith(today)).slice(0, 50);

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
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#34a853' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 12, color: '#fff', marginTop: 4, opacity: 0.9 },
  addBtn: { backgroundColor: 'rgba(255,255,255,0.2)', padding: 10, borderRadius: 8 },
  addBtnText: { color: '#fff', fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', padding: 16, paddingBottom: 8 },
  item: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 10 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemTitle: { fontSize: 16, color: '#333', fontWeight: '600', flex: 1 },
  itemAmount: { fontSize: 16, color: '#34a853', fontWeight: 'bold' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  itemDate: { fontSize: 12, color: '#999' },
  itemMethod: { fontSize: 12, color: '#666' },
  itemNotes: { fontSize: 13, color: '#444', marginTop: 6, fontStyle: 'italic' },
  empty: { textAlign: 'center', color: '#999', padding: 30 },
});
