import {platformTools} from '../utils/platform-tools';
import {canOpenAppRoute} from '../utils/app-access';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius } from '../theme';
import { canUseMobileFeature } from '../utils/mobile-permissions';

export default function AppearanceMenu({ visible, onClose, onNavigate, permissions }: {
  visible: boolean; onClose: () => void; onNavigate: (route: string) => void; permissions: readonly string[];
}) {
  const insets = useSafeAreaInsets();
  const can = (code: string, legacy: string) => canUseMobileFeature(permissions, code, legacy);
  const entries: Array<{ title: string; route: string; icon: keyof typeof Ionicons.glyphMap; visible: boolean }> = [
    ...platformTools.map(t=>({title:t.title,route:t.route,icon:t.icon as keyof typeof Ionicons.glyphMap,visible:permissions.includes(t.permission)})),
    { title: 'خدمات الموظفين', route: 'HrCenter', icon: 'people-outline', visible: true },
    { title: 'حسابي', route: 'Profile', icon: 'person-circle-outline', visible: true },
    { title: 'حجوزات البضاعة', route: 'Reservations', icon: 'cube-outline', visible: permissions.some(p => ['mobile.reservations.view', 'reservations.read', 'reservations.create'].includes(p)) },
    { title: 'المخزون', route: 'Inventory', icon: 'layers-outline', visible: can('mobile.inventory.view', 'reports.read') },
    { title: 'المتابعات', route: 'FollowupsList', icon: 'chatbubbles-outline', visible: can('mobile.followups.view', 'followups.create') },
    { title: 'وعود السداد', route: 'PromisesList', icon: 'calendar-outline', visible: can('mobile.promises.view', 'promises.create') },
    { title: 'التحصيلات', route: 'CollectionsList', icon: 'cash-outline', visible: can('mobile.collections.view', 'collections.create') },
    { title: 'قوالب الرسائل', route: 'MessageTemplates', icon: 'document-text-outline', visible: can('mobile.messages.view', 'followups.create') },
    { title: 'الإشعارات', route: 'Notifications', icon: 'notifications-outline', visible: true },
    { title: 'الإعدادات والمزامنة', route: 'Settings', icon: 'settings-outline', visible: true },
  ];
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={[styles.overlay, { paddingTop: insets.top + 20 }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="إغلاق القائمة" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]} accessibilityViewIsModal>
        <View style={styles.handle} />
        <View style={styles.heading}>
          <Text style={styles.title}>المزيد</Text>
          <Pressable style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel="إغلاق القائمة"><Ionicons name="close" size={23} color={colors.primary} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {entries.filter(entry => entry.visible && canOpenAppRoute(entry.route,permissions)).map(entry => <Pressable key={entry.route} accessibilityRole="button" style={({ pressed }) => [styles.item, pressed && styles.pressed]} onPress={() => { onClose(); onNavigate(entry.route); }}>
            <View style={styles.icon}><Ionicons name={entry.icon} size={23} color={colors.primary} /></View>
            <Text style={styles.label}>{entry.title}</Text>
            <Ionicons name="chevron-back" size={17} color={colors.muted} />
          </Pressable>)}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,35,28,0.45)' },
  sheet: { maxHeight: '90%', backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginTop: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 },
  title: { fontFamily: fonts.bold, fontSize: 23, color: colors.primary },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.primarySoft },
  content: { paddingHorizontal: 16, paddingBottom: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, padding: 10, borderRadius: radius.md, marginBottom: 4 },
  pressed: { backgroundColor: colors.primarySoft },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontFamily: fonts.bold, fontSize: 16, color: colors.ink, textAlign: 'right' },
});
