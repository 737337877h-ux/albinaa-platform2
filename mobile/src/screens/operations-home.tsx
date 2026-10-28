import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../store/auth-context';
import { useSync } from '../store/sync-context';
import { colors, fonts } from '../theme';
import { canOpenOperationsRoute } from '../utils/operations-access';
import { product } from '../config/product';

type Entry = { title: string; route: string; icon: keyof typeof Ionicons.glyphMap; description?: string };
const inventory: Entry[] = [
  { title: 'الأصناف والمخزون', route: 'Inventory', icon: 'cube-outline', description: 'بحث بالاسم والكود أو مسح الباركود' },
  { title: 'الجرد', route: 'NewInventoryCount', icon: 'scan-outline', description: 'نفس خطوات الجرد والوحدات وحفظ المسودة' },
  { title: 'التحويل المخزني', route: 'RequestInventoryTransfer', icon: 'swap-horizontal-outline', description: 'مخزن المصدر والوجهة والأصناف والكميات' },
  { title: 'حجوزات البضاعة', route: 'Reservations', icon: 'file-tray-stacked-outline' },
  { title: 'تصميم وطباعة الباركود', route: 'BarcodeDesign', icon: 'barcode-outline', description: 'طباعة الملصقات عبر طابعة المنصة' },
];
const tasks: Entry[] = [
  { title: 'مهامي اليومية', route: 'HrTasks', icon: 'checkbox-outline', description: 'التفاصيل والمرفقات وإرسال الإنجاز' },
  { title: 'إسناد مهمة لموظف', route: 'AssignHrTask', icon: 'add-circle-outline', description: 'موظف أو عدة موظفين، مع الصور والملفات' },
  { title: 'مراجعة إنجاز المهام', route: 'HrTaskReview', icon: 'checkmark-done-outline', description: 'مراجعة النتائج والتقييم' },
];
const services: Entry[] = [
  { title: 'الحضور والانصراف', route: 'HrAttendance', icon: 'finger-print-outline', description: 'الدخول والاستراحة والعودة والانصراف' },
  { title: 'طلبات السلف والإجازات', route: 'HrRequests', icon: 'calendar-outline', description: 'طلباتي وحالة الموافقة' },
  { title: 'كشف راتبي', route: 'HrMyPayroll', icon: 'document-text-outline', description: 'كشف الراتب بعد اعتماده' },
  { title: 'مراجعة طلبات الموظفين', route: 'HrRequestReview', icon: 'checkmark-circle-outline' },
  { title: 'المستخدمون', route: 'ManageUsers', icon: 'people-outline' },
  { title: 'الأدوار والصلاحيات', route: 'ManageRoles', icon: 'shield-checkmark-outline' },
  { title: 'الإعدادات والمزامنة', route: 'Settings', icon: 'settings-outline' },
];

function Entries({ entries, navigation }: { entries: Entry[]; navigation: any }) {
  const permissions = useAuth().user?.permissions ?? [];
  const allowed = entries.filter(e => canOpenOperationsRoute(e.route, permissions));
  return <View style={s.list}>{allowed.length === 0 ? <Text style={s.note}>لا توجد وظائف متاحة ضمن صلاحيات حسابك.</Text> : allowed.map(e => <TouchableOpacity key={e.route} accessibilityRole="button" style={s.row} onPress={() => navigation.navigate(e.route)}>
    <View style={s.icon}><Ionicons name={e.icon} size={23} color={colors.primary} /></View>
    <View style={{ flex: 1 }}><Text style={s.rowTitle}>{e.title}</Text>{e.description && <Text style={s.note}>{e.description}</Text>}</View>
    <Ionicons name="chevron-back" size={18} color={colors.muted} />
  </TouchableOpacity>)}</View>;
}
function Hub({ title, subtitle, entries, navigation, children }: { title: string; subtitle: string; entries: Entry[]; navigation: any; children?: React.ReactNode }) {
  return <ScrollView style={s.screen} contentContainerStyle={s.content}><Text style={s.title}>{title}</Text><Text style={s.note}>{subtitle}</Text><Entries entries={entries} navigation={navigation} />{children}</ScrollView>;
}
export function OperationsInventory(props: any) { return <Hub {...props} title="المخزون" subtitle="الأصناف والجرد والتحويلات والطباعة" entries={inventory} />; }
export function OperationsTasks(props: any) { return <Hub {...props} title="مهام الموظفين" subtitle="من إسناد المهمة إلى مراجعة الإنجاز" entries={tasks} />; }
export function OperationsServices(props: any) {
  const { user, logout } = useAuth();
  return <Hub {...props} title="خدماتي" subtitle={user?.fullName || user?.username || 'خدمات الموظف'} entries={services}>
    {!product.pushConfigured && <Text style={s.note}>الإشعارات داخل التطبيق متاحة. الإشعارات البعيدة لهذه النسخة الجديدة ما زالت قيد التجهيز.</Text>}
    <TouchableOpacity style={s.logout} onPress={() => Alert.alert('تسجيل الخروج', 'سيُقفل هذا التطبيق فقط.', [{ text: 'إلغاء', style: 'cancel' }, { text: 'تسجيل الخروج', onPress: () => void logout() }])}><Text style={s.rowTitle}>تسجيل الخروج</Text></TouchableOpacity>
  </Hub>;
}
export default function OperationsHome({ navigation }: any) {
  const { user } = useAuth();
  const { status, triggerSync } = useSync();
  const permissions = user?.permissions ?? [];
  const can = (r: string) => canOpenOperationsRoute(r, permissions);
  const phase = status.phase === 'synced' ? 'تمت المزامنة' : status.phase === 'syncing' ? (status.stage || 'جارٍ تحديث البيانات') : status.phase === 'offline' ? 'دون اتصال · البيانات المحفوظة' : status.phase === 'error' ? 'تحتاج المزامنة إلى مراجعة' : 'التحقق من المزامنة';
  const shortcuts = [inventory[1], inventory[2], inventory[4], services[0]].filter(e => can(e.route));
  return <SafeAreaView edges={['top']} style={s.screen}>
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.header}><View style={{ flex: 1 }}><Text style={s.brand}>الراقي<Text style={{ color: colors.gold }}>.</Text></Text><Text style={s.note}>إدارة العملاء والمخزون</Text></View><TouchableOpacity accessibilityLabel="الإشعارات" style={s.icon} onPress={() => navigation.navigate('Notifications')}><Ionicons name="notifications-outline" size={24} color={colors.primary} /></TouchableOpacity></View>
      <TouchableOpacity accessibilityRole="button" style={s.sync} onPress={() => void triggerSync()}><Ionicons name={status.phase === 'offline' ? 'cloud-offline-outline' : 'sync-outline'} size={16} color={colors.primary} /><Text style={s.note}>{phase}</Text></TouchableOpacity>
      <Text style={s.title}>أهلًا {user?.fullName || user?.username || 'بك'}</Text><Text style={s.note}>طلباتك ومخزونك، في مكان واحد</Text>
      {(can('NewCustomerOrder') || can('NewQuotation')) && <View style={s.hero}><View style={s.goldLine} /><Text style={s.heroTitle}>ابدأ طلبك بسهولة</Text><Text style={s.heroNote}>اختر العميل، أضف الأصناف، ثم راجع الطلب.</Text><View style={s.actions}>{can('NewCustomerOrder') && <TouchableOpacity style={s.primary} onPress={() => navigation.navigate('NewCustomerOrder')}><Text style={s.primaryText}>+ طلب عميل</Text></TouchableOpacity>}{can('NewQuotation') && <TouchableOpacity style={s.secondary} onPress={() => navigation.navigate('NewQuotation')}><Text style={s.secondaryText}>عرض سعر</Text></TouchableOpacity>}</View></View>}
      <Text style={s.section}>وصول سريع</Text><View style={s.shortcuts}>{shortcuts.map(e => <TouchableOpacity key={e.route} style={s.shortcut} onPress={() => navigation.navigate(e.route)}><View style={s.icon}><Ionicons name={e.icon} size={25} color={colors.primary} /></View><Text style={s.shortcutText}>{e.title === 'تصميم وطباعة الباركود' ? 'الباركود' : e.title === 'الحضور والانصراف' ? 'حضوري' : e.title}</Text></TouchableOpacity>)}</View>
      <Text style={s.section}>تابع عملك</Text><Entries navigation={navigation} entries={[
        { title: 'الطلبات والمسودات', route: 'RequestCenter', icon: 'documents-outline', description: status.pending > 0 ? `${status.pending} عملية محلية بانتظار المزامنة` : 'عرض الطلبات وحالاتها والمسودات المحفوظة' },
        { title: 'مهامي اليومية', route: 'HrTasks', icon: 'checkbox-outline', description: 'التفاصيل والصور وإرسال الإنجاز' },
        ...(status.blocked > 0 ? [{ title: 'عمليات تحتاج إلى مراجعة', route: 'Settings', icon: 'alert-circle-outline' as const, description: `${status.blocked} عملية` }] : []),
      ]} />
    </ScrollView>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, content: { padding: 18, paddingBottom: 32, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 }, brand: { fontFamily: fonts.bold, fontSize: 30, color: colors.primary, textAlign: 'right' },
  title: { fontFamily: fonts.bold, fontSize: 23, color: colors.ink, marginTop: 10, textAlign: 'right' }, note: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, lineHeight: 22, textAlign: 'right' },
  sync: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  hero: { backgroundColor: colors.primary, borderRadius: 18, padding: 18, marginVertical: 10, gap: 7 }, goldLine: { width: 30, height: 3, backgroundColor: colors.gold, borderRadius: 3 },
  heroTitle: { color: '#fff', fontFamily: fonts.bold, fontSize: 21, textAlign: 'right' }, heroNote: { color: '#E2EFEA', fontFamily: fonts.regular, fontSize: 15, textAlign: 'right' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 }, primary: { minHeight: 46, backgroundColor: '#fff', borderRadius: 12, padding: 12, justifyContent: 'center' }, primaryText: { fontFamily: fonts.bold, color: colors.primary, fontSize: 16 },
  secondary: { minHeight: 46, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#FFFFFF80', justifyContent: 'center' }, secondaryText: { fontFamily: fonts.bold, color: '#fff', fontSize: 16 },
  section: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18, marginTop: 12, textAlign: 'right' }, shortcuts: { flexDirection: 'row', justifyContent: 'space-around', gap: 4 }, shortcut: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 8 }, shortcutText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink, textAlign: 'center' },
  icon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  list: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, marginTop: 8, overflow: 'hidden' }, row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, minHeight: 78 }, rowTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink, textAlign: 'right' },
  logout: { padding: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.line, marginTop: 14, alignItems: 'center' },
});
