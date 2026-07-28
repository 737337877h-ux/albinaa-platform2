import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getAll } from '../db/database';
import Loading from '../components/loading';

export default function CustomersScreen({ navigation }: any) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        setCustomers(await getAll('customers'));
        setLoading(false);
      })();
    }, []),
  );

  const filtered = customers.filter((c) =>
    !search || c.fullName?.includes(search) || c.phonePrimary?.includes(search),
  );

  if (loading) return <Loading />;

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="بحث عن عميل..."
        placeholderTextColor="#999"
        value={search}
        onChangeText={setSearch}
      />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.item} onPress={() => navigation.navigate('Customer360', { id: item.id })}>
            <Text style={styles.name}>{item.fullName}</Text>
            <Text style={styles.phone}>{item.phonePrimary}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>لا يوجد عملاء</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  search: { margin: 16, padding: 12, backgroundColor: '#fff', borderRadius: 10, fontSize: 16, color: '#333', textAlign: 'right' },
  item: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 10 },
  name: { fontSize: 16, color: '#333', fontWeight: '600' },
  phone: { fontSize: 14, color: '#666', marginTop: 4 },
  empty: { textAlign: 'center', color: '#999', padding: 40 },
});
