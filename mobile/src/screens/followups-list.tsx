import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getAll } from '../db/database';
import { colors, radius, shadow } from '../theme';

export default function FollowupsListScreen({ navigation }: any) {
  const [localFollowups, setLocalFollowups] = useState<any[]>([]);

  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        setLocalFollowups(await getAll('followups'));
      })();
    }, []),
  );

  // Dedupe by id
  const seen = new Set<string>();
  const all: any[] = [];
  for (const f of localFollowups) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    all.push(f);
  }
  all.sort((a, b) => (b.followupAt || b.updatedAt || '').localeCompare(a.followupAt || a.updatedAt || ''));

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayFollowups = all.filter((f) => {
    if (!f.followupAt) return false;
    const date = new Date(f.followupAt);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` === today;
  });
  const todayIds = new Set(todayFollowups.map((f) => f.id));
  const recentFollowups = all.filter((f) => !todayIds.has(f.id)).slice(0, 50);

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
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', padding: 18, backgroundColor: colors.primary },
  title: { fontSize: 22, fontWeight: '900', color: '#fff', textAlign: 'right' },
  subtitle: { fontSize: 12, color: colors.warmGray, marginTop: 4, textAlign: 'right' },
  addBtn: { backgroundColor: colors.gold, paddingHorizontal: 14, paddingVertical: 11, borderRadius: radius.pill, ...shadow },
  addBtnText: { color: colors.primary, fontWeight: '800' },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.primary, padding: 16, paddingBottom: 8, textAlign: 'right' },
  item: { backgroundColor: colors.surface, marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, ...shadow },
  itemHeader: { flexDirection: 'row-reverse', justifyContent: 'space-between' },
  itemTitle: { fontSize: 16, color: colors.primary, fontWeight: '800', textAlign: 'right' },
  itemDate: { fontSize: 12, color: colors.muted },
  itemSub: { fontSize: 13, color: colors.muted, marginTop: 4, textAlign: 'right' },
  itemNotes: { fontSize: 13, color: colors.ink, marginTop: 6, textAlign: 'right' },
  empty: { textAlign: 'center', color: colors.muted, padding: 30 },
});
