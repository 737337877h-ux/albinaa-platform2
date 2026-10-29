import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, Modal } from 'react-native';
import { getCustomerOptionsOffline } from '../db/database';
import { colors, radius, shadow } from '../theme';
import { matchesSmartSearch } from '../utils/search';

export interface CustomerOption {
  id: string;
  fullName: string;
  phonePrimary?: string | null;
  phoneSecondary?: string | null;
  whatsapp?: string | null;
  accountCode?: string | null;
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
      const all = await getCustomerOptionsOffline();
      const seen = new Set<string>();
      const unique: CustomerOption[] = [];
      for (const c of all) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        unique.push({
          id: c.id,
          fullName: c.fullName || c.name || 'عميل',
          phonePrimary: c.phonePrimary || null,
          phoneSecondary: c.phoneSecondary || null,
          whatsapp: c.whatsapp || null,
          accountCode: c.externalCustomerCode || c.accountNumber || null,
        });
      }
      setCustomers(unique);
    })();
  }, []);

  const openModal = async () => {
    const all = await getCustomerOptionsOffline();
    const seen = new Set<string>();
    const unique: CustomerOption[] = [];
    for (const c of all) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      unique.push({
        id: c.id,
        fullName: c.fullName || c.name || 'عميل',
        phonePrimary: c.phonePrimary || null,
        phoneSecondary: c.phoneSecondary || null,
        whatsapp: c.whatsapp || null,
        accountCode: c.externalCustomerCode || c.accountNumber || null,
      });
    }
    setCustomers(unique);
    setSearch('');
    setOpen(true);
  };

  const filtered = customers.filter((c) =>
    matchesSmartSearch([c.fullName, c.phonePrimary, c.phoneSecondary, c.whatsapp, c.accountCode].filter(Boolean).join(' '), search),
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
            placeholder="ابحث بالاسم أو الكود أو رقم الهاتف..."
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
                <Text style={styles.customerPhone}>
                  {[item.accountCode && `#${item.accountCode}`, item.phonePrimary, item.phoneSecondary].filter(Boolean).join(' · ') || 'لا يوجد رقم هاتف'}
                </Text>
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
  label: { fontFamily: 'TajawalBold', fontSize: 16, fontWeight: '800', color: colors.ink, marginBottom: 8, marginTop: 16, textAlign: 'right' },
  pickerBtn: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.line },
  pickerText: { fontFamily: 'TajawalRegular', fontSize: 16, color: colors.ink, textAlign: 'right' },
  modalContainer: { flex: 1, backgroundColor: colors.background, paddingTop: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: colors.primary, borderBottomWidth: 2, borderBottomColor: colors.gold },
  modalTitle: { fontFamily: 'TajawalBold', color: colors.background, fontSize: 18, fontWeight: '900' },
  modalClose: { fontFamily: 'TajawalBold', color: colors.gold, fontSize: 15, fontWeight: '900' },
  searchInput: { fontFamily: 'TajawalRegular', margin: 16, padding: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, fontSize: 16, color: colors.ink, textAlign: 'right' },
  customerRow: { backgroundColor: colors.surface, marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, ...shadow },
  customerRowActive: { borderColor: colors.gold, borderWidth: 2, backgroundColor: colors.goldSoft },
  customerName: { fontFamily: 'TajawalBold', fontSize: 16, color: colors.ink, fontWeight: '800', textAlign: 'right' },
  customerPhone: { fontFamily: 'TajawalRegular', fontSize: 14, color: colors.muted, marginTop: 4, textAlign: 'right' },
  emptyText: { textAlign: 'center', color: colors.muted, padding: 30 },
});
