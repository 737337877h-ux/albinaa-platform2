import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { getAll } from '../db/database';
import { fetchSync } from '../api/endpoints';
import { getMeta } from '../db/database';
import Loading from '../components/loading';

export default function FollowupsListScreen({ navigation }: any) {
  const [localFollowups, setLocalFollowups] = useState<any[]>([]);

  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        setLocalFollowups(await getAll('followups'));
      })();
    }, []),
  );

  const { data: syncData, isLoading } = useQuery({
    queryKey: ['sync-followups'],
    queryFn: async () => {
      const token = await getMeta('syncToken');
      const res = await fetchSync(token || undefined);
      return res.data;
    },
  });

  if (isLoading && !syncData) return <Loading />;

  const remoteFollowups = syncData?.followups || [];
  // Dedupe by id
  const seen = new Set<string>();
  const all: any[] = [];
  for (const f of [...localFollowups, ...remoteFollowups]) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    all.push(f);
  }
  all.sort((a, b) => (b.followupAt || b.updatedAt || '').localeCompare(a.followupAt || a.updatedAt || ''));

  const today = new Date().toISOString().split('T')[0];
  const todayFollowups = all.filter((f) => f.followupAt?.startsWith(today));
  const recentFollowups = all.filter((f) => !f.followupAt?.startsWith(today)).slice(0, 50);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>المتابعات</Text>
          <Text style={styles.subtitle}>اليوم: {todayFollowups.length} | الإجمالي: {all.length}</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('NewFollowup')}>
          <Text style={styles.addBtnText}>+ متابعة</Text>
        </TouchableOpacity>
      </View>

      {todayFollowups.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>متابعات اليوم</Text>
          <FlatList
            data={todayFollowups}
            keyExtractor={(item) => `today-${item.id}`}
            renderItem={({ item }) => <FollowupItem item={item} navigation={navigation} />}
          />
        </>
      )}

      <Text style={styles.sectionTitle}>المتابعات السابقة</Text>
      {recentFollowups.length === 0 ? (
        <Text style={styles.empty}>لا توجد متابعات سابقة</Text>
      ) : (
        <FlatList
          data={recentFollowups}
          keyExtractor={(item) => `prev-${item.id}`}
          renderItem={({ item }) => <FollowupItem item={item} navigation={navigation} />}
        />
      )}
    </View>
  );
}

function FollowupItem({ item, navigation }: { item: any; navigation: any }) {
  return (
    <TouchableOpacity
      style={styles.item}
      onPress={() => item.customerId && navigation.navigate('Customer360', { id: item.customerId })}
    >
      <View style={styles.itemHeader}>
        <Text style={styles.itemTitle}>{item.customerName || item.typeName || 'متابعة'}</Text>
        <Text style={styles.itemDate}>
          {item.followupAt ? new Date(item.followupAt).toLocaleDateString('ar-SA') : ''}
        </Text>
      </View>
      {!!item.typeName && <Text style={styles.itemSub}>النوع: {item.typeName}</Text>}
      {!!item.resultName && <Text style={styles.itemSub}>النتيجة: {item.resultName}</Text>}
      {!!item.notes && <Text style={styles.itemNotes}>{item.notes}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#1a73e8' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 12, color: '#fff', marginTop: 4, opacity: 0.9 },
  addBtn: { backgroundColor: 'rgba(255,255,255,0.2)', padding: 10, borderRadius: 8 },
  addBtnText: { color: '#fff', fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', padding: 16, paddingBottom: 8 },
  item: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 10 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  itemTitle: { fontSize: 16, color: '#333', fontWeight: '600' },
  itemDate: { fontSize: 12, color: '#999' },
  itemSub: { fontSize: 13, color: '#666', marginTop: 4 },
  itemNotes: { fontSize: 13, color: '#444', marginTop: 6, fontStyle: 'italic' },
  empty: { textAlign: 'center', color: '#999', padding: 30 },
});
