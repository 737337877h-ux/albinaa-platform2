import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, Modal } from 'react-native';
import { getAll } from '../db/database';

export interface CustomerOption {
  id: string;
  fullName: string;
  phonePrimary?: string | null;
}

interface Props {
  selectedId: string;
  selectedName: string;
  onSelect: (c: CustomerOption) => void;
  required?: boolean;
}

export default function CustomerPicker({ selectedId, selectedName, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<CustomerOption[]>([]);

  useEffect(() => {
    (async () => {
      const all = await getAll('customers');
      const seen = new Set<string>();
      const unique: CustomerOption[] = [];
      for (const c of all) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        unique.push({
          id: c.id,
          fullName: c.fullName || c.name || 'عميل',
          phonePrimary: c.phonePrimary || null,
        });
      }
      setCustomers(unique);
    })();
  }, []);

  const openModal = async () => {
    const all = await getAll('customers');
    const seen = new Set<string>();
    const unique: CustomerOption[] = [];
    for (const c of all) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      unique.push({
        id: c.id,
        fullName: c.fullName || c.name || 'عميل',
        phonePrimary: c.phonePrimary || null,
      });
    }
    setCustomers(unique);
    setSearch('');
    setOpen(true);
  };

  const filtered = customers.filter((c) =>
    !search || c.fullName?.includes(search) || (c.phonePrimary || '').includes(search),
  );

  return (
    <>
      <Text style={styles.label}>العميل</Text>
      <TouchableOpacity style={styles.pickerBtn} onPress={openModal}>
        <Text style={styles.pickerText}>{selectedName || '— اختر عميلاً —'}</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>اختر عميلاً</Text>
            <TouchableOpacity onPress={() => setOpen(false)}>
              <Text style={styles.modalClose}>إغلاق</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="ابحث عن عميل..."
            placeholderTextColor="#999"
            value={search}
            onChangeText={setSearch}
          />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.customerRow, selectedId === item.id && styles.customerRowActive]}
                onPress={() => {
                  onSelect(item);
                  setOpen(false);
                }}
              >
                <Text style={styles.customerName}>{item.fullName}</Text>
                {!!item.phonePrimary && <Text style={styles.customerPhone}>{item.phonePrimary}</Text>}
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>لا يوجد عملاء</Text>}
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8, marginTop: 16 },
  pickerBtn: { backgroundColor: '#fff', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#ddd' },
  pickerText: { fontSize: 16, color: '#333' },
  modalContainer: { flex: 1, backgroundColor: '#f0f4f8', paddingTop: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#1a73e8' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  modalClose: { color: '#fff', fontSize: 14, fontWeight: '600' },
  searchInput: { margin: 16, padding: 12, backgroundColor: '#fff', borderRadius: 10, fontSize: 16, textAlign: 'right' },
  customerRow: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 6, padding: 14, borderRadius: 10 },
  customerRowActive: { borderColor: '#1a73e8', borderWidth: 2 },
  customerName: { fontSize: 16, color: '#333', fontWeight: '500' },
  customerPhone: { fontSize: 13, color: '#666', marginTop: 4 },
  emptyText: { textAlign: 'center', color: '#999', padding: 30 },
});
