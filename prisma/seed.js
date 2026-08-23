// ============================================================================
// Seed — البيانات المرجعية الأولية (Sprint 1)
// يعتمد على نتائج التحليل الفعلي لملف عملاء_تحليلي_16-07-2026.xlsx:
// - 3 عملات مكتشفة (YER / SAR / USD)
// - 9 أنواع مستندات مكتشفة مع أثرها المرصود من 7,102 حركة حقيقية
// - الأدوار الخمسة من مستند المتطلبات + صلاحيات أساسية
// تشغيل: npx prisma db seed   (idempotent — آمن لإعادة التشغيل)
// ============================================================================
let PrismaClient;
try {
  ({ PrismaClient } = require('@prisma/client'));
} catch (error) {
  // The schema intentionally generates the client beside the backend package.
  // Keep root-level `npm run db:seed` working in clean installations as well.
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  ({ PrismaClient } = require('../backend/node_modules/.prisma/client'));
}
const crypto = require('crypto');

const prisma = new PrismaClient();

// كلمة مرور مبدئية للمدير — يجب تغييرها فور أول تسجيل دخول.
// الصيغة: scrypt$N=16384,r=8,p=1$<salt_hex>$<hash_hex>  (بدون تبعيات خارجية)
function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$N=16384,r=8,p=1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function main() {
  const units = [
    { code: 'TON', nameAr: 'طن', weightKg: 1000 },
    { code: 'BAG50', nameAr: 'كيس 50كجم', weightKg: 50 },
    { code: 'BAG25', nameAr: 'كيس 25كجم', weightKg: 25 },
    { code: 'PCS', nameAr: 'حبة', weightKg: null },
    { code: 'ROLL', nameAr: 'لفة', weightKg: null },
  ];
  for (const unit of units) {
    await prisma.unit.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }

  // ------------------------------------------------------------------ العملات
  const currencies = [
    { code: 'YER', sourceCode: 'YR', nameAr: 'ريال يمني', decimals: 2 },
    { code: 'SAR', sourceCode: 'SR', nameAr: 'ريال سعودي', decimals: 2 },
    { code: 'USD', sourceCode: '$', nameAr: 'دولار أمريكي', decimals: 2 },
  ];
  for (const c of currencies) {
    await prisma.currency.upsert({ where: { code: c.code }, update: {}, create: c });
  }

  // ------------------------------------------------------------------ المنشأة والفرع
  let org = await prisma.organization.findFirst({ where: { name: 'البناء الراقي' } });
  if (!org) org = await prisma.organization.create({ data: { name: 'البناء الراقي' } });

  const branch = await prisma.branch.upsert({
    where: { organizationId_name: { organizationId: org.id, name: 'الفرع الرئيسي' } },
    update: {},
    create: { organizationId: org.id, name: 'الفرع الرئيسي' },
  });

  // ------------------------------------------------------------------ أنواع المستندات
  // الأثر (effect) مرصود من البيانات الفعلية — راجع تقرير التحليل:
  const documentTypes = [
    { name: 'فاتورة المبيعات آجل',        effect: 'debit',  notes: '4,141 حركة — مديونية جديدة' },
    { name: 'سند قبض نقدي',               effect: 'credit', notes: '1,016 حركة — تحصيل' },
    { name: 'قيد يومية',                  effect: 'mixed',  notes: '725 حركة — تسويات وتحويلات (66 مدين / 659 دائن)' },
    { name: 'فاتورة مردود المبيعات آجل',  effect: 'credit', notes: '488 حركة — مرتجع يخفض الدين' },
    { name: 'سند صرف نقدي',               effect: 'debit',  notes: '447 حركة' },
    { name: 'أمر توريد مخزني',            effect: 'credit', notes: '276 حركة — كلها دائنة في البيانات؛ بانتظار توضيح المحاسب لطبيعتها' },
    { name: 'فاتورة المشتريات آجل',       effect: 'credit', notes: '7 حركات' },
    { name: 'سند قبض بنكي',               effect: 'credit', notes: 'حركة واحدة' },
    { name: 'سند صرف بنكي',               effect: 'debit',  notes: 'حركة واحدة' },
  ];
  for (const dt of documentTypes) {
    await prisma.documentType.upsert({
      where: { organizationId_name: { organizationId: org.id, name: dt.name } },
      update: { effect: dt.effect, notes: dt.notes },
      create: { organizationId: org.id, ...dt },
    });
  }

  // ------------------------------------------------------------------ طرق التحصيل
  for (const name of ['نقدي', 'تحويل بنكي', 'شيك', 'محفظة إلكترونية']) {
    await prisma.collectionMethod.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {},
      create: { organizationId: org.id, name },
    });
  }

  // ------------------------------------------------------------------ أنواع ونتائج المتابعة (من مستند المتطلبات)
  const followupTypes = ['مكالمة هاتفية', 'رسالة واتساب', 'زيارة ميدانية', 'رسالة نصية', 'بريد إلكتروني', 'متابعة إدارية'];
  for (const name of followupTypes) {
    await prisma.followupType.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {}, create: { organizationId: org.id, name },
    });
  }
  const followupResults = [
    'تم التواصل', 'لا يرد', 'الهاتف مغلق', 'مشغول', 'وعد بالسداد', 'سدد جزءًا',
    'تم السداد', 'طلب تأجيل', 'يحتاج زيارة', 'مسافر', 'لا توجد سيولة',
    'شيك مؤجل', 'يوجد خلاف', 'رفض السداد', 'متعثر', 'سبب آخر',
  ];
  for (const name of followupResults) {
    await prisma.followupResult.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {}, create: { organizationId: org.id, name },
    });
  }

  // ------------------------------------------------------------------ الصلاحيات
  const permissions = [
    ['customers.read', 'عرض العملاء'],
    ['customers.read_all', 'رؤية جميع العملاء (بدون هذه الصلاحية: المحصل يرى المسندين إليه فقط)'],
    ['customers.write', 'تعديل بيانات العملاء'],
    ['customers.transfer', 'نقل العملاء بين المحصلين'],
    ['balances.read', 'عرض الأرصدة'],
    ['collections.create', 'تسجيل تحصيل'],
    ['collections.reverse', 'عكس تحصيل بإجراء موثق'],
    ['collections.approve', 'اعتماد التحصيلات'],
    ['cash.receive', 'تأكيد استلام النقدية في الصندوق'],
    ['followups.create', 'تسجيل متابعة'],
    ['promises.create', 'تسجيل وعد سداد'],
    ['tasks.manage', 'إدارة المهام'],
    ['imports.run', 'تنفيذ استيراد Excel'],
    ['imports.read', 'عرض سجل الاستيراد'],
    ['imports.reverse', 'التراجع الآمن عن أحدث دفعة استيراد'],
    ['reconciliation.review', 'مراجعة واعتماد التسويات'],
    ['reports.read', 'عرض التقارير'],
    ['reports.export', 'تصدير التقارير'],
    ['users.manage', 'إدارة المستخدمين والصلاحيات'],
    ['settings.manage', 'إدارة الإعدادات'],
    ['audit.read', 'عرض سجل التدقيق'],
    ['mobile.delivery.customers.view_all_no_balance', 'عرض جميع العملاء ومواقعهم دون الأرصدة لمندوب التوصيل'],
    ['duplicates.review', 'مراجعة حالات تشابه العملاء'],
    ['duplicates.merge', 'دمج العملاء المكررين والتراجع عن الدمج'],
    ['risk.read', 'عرض درجة المخاطر'],
    ['risk.recalculate', 'إعادة احتساب درجات المخاطر'],
    ['reservations.manage', 'إدارة حجوزات البضاعة'],
    ['reservations.read', 'عرض حجوزات البضاعة'],
    ['reservations.create', 'إنشاء حجوزات البضاعة'],
    ['reservations.deliver', 'تسليم حجوزات البضاعة'],
    ['reservations.cancel', 'إلغاء حجوزات البضاعة'],
    ['reservations.extend', 'تمديد حجوزات البضاعة'],
    ['credit.override', 'تجاوز سقف الائتمان بسبب موثق'],
    ['finance.alerts.receive', 'استلام التنبيهات المالية الفورية'],
    ['periods.manage', 'إدارة إقفال الفترات المحاسبية'],
    ['periods.override', 'تجاوز فترة محاسبية مقفلة بسبب موثق'],
    ['analytical_accounts.manage', 'إدارة الحسابات التحليلية'],
    ['analytical_accounts.read', 'عرض الحسابات التحليلية'],
    ['inventory_transfers.read', 'عرض طلبات التحويل المخزني'],
    ['inventory_transfers.create', 'إنشاء وإرسال طلبات التحويل المخزني'],
    ['inventory_transfers.approve', 'اعتماد أو رفض طلبات التحويل المخزني'],
    ['inventory_transfers.dry_run', 'تنفيذ فحص Oracle للقراءة فقط'],
    ['mobile.dashboard.view', 'تطبيق الهاتف: عرض الصفحة الرئيسية'],
    ['mobile.tasks.view', 'تطبيق الهاتف: عرض المهام'],
    ['mobile.tasks.create', 'تطبيق الهاتف: إنشاء مهمة'],
    ['mobile.customers.view', 'تطبيق الهاتف: عرض العملاء'],
    ['mobile.advances.view', 'تطبيق الهاتف: عرض السلف'],
    ['mobile.collections.view', 'تطبيق الهاتف: عرض التحصيلات'],
    ['mobile.collections.create', 'تطبيق الهاتف: تسجيل تحصيل'],
    ['mobile.followups.view', 'تطبيق الهاتف: عرض المتابعات'],
    ['mobile.followups.create', 'تطبيق الهاتف: تسجيل متابعة'],
    ['mobile.promises.view', 'تطبيق الهاتف: عرض وعود السداد'],
    ['mobile.promises.create', 'تطبيق الهاتف: تسجيل وعد سداد'],
    ['mobile.reservations.view', 'تطبيق الهاتف: عرض حجوزات البضاعة'],
    ['mobile.reservations.create', 'تطبيق الهاتف: إضافة حجز بضاعة'],
    ['mobile.inventory.view', 'تطبيق الهاتف: عرض الأصناف والمخزون'],
    ['mobile.receipts.view', 'تطبيق الهاتف: معاينة صور الإيصالات'],
    ['mobile.receipts.upload', 'تطبيق الهاتف: رفع صورة إيصال'],
    ['mobile.location.view', 'تطبيق الهاتف: عرض الموقع'],
    ['mobile.location.update', 'تطبيق الهاتف: تحديث الموقع'],
    ['mobile.financial_adjustments.request', 'تطبيق الهاتف: طلب خصم أو تصفية'],
    ['mobile.assignment_change.request', 'تطبيق الهاتف: طلب تغيير الإسناد'],
    ['mobile.notifications.view', 'تطبيق الهاتف: عرض الإشعارات'],
    ['mobile.messages.view', 'تطبيق الهاتف: استخدام قوالب الرسائل'],
  ];
  for (const [code, descriptionAr] of permissions) {
    await prisma.permission.upsert({ where: { code }, update: { descriptionAr }, create: { code, descriptionAr } });
  }
  const allPerms = await prisma.permission.findMany();
  const permId = Object.fromEntries(allPerms.map((p) => [p.code, p.id]));

  // ------------------------------------------------------------------ الأدوار (RBAC)
  const rolesDef = {
    'مدير النظام': allPerms.map((p) => p.code), // كل الصلاحيات
    'مدير المديونية': [
      'customers.read', 'customers.read_all', 'customers.transfer', 'balances.read', 'followups.create',
      'promises.create', 'tasks.manage', 'reports.read', 'reports.export', 'duplicates.review', 'duplicates.merge',
      'risk.read', 'risk.recalculate', 'reservations.manage', 'reservations.read',
      'reservations.create', 'reservations.deliver', 'reservations.cancel', 'reservations.extend',
      'credit.override',
      'finance.alerts.receive',
      'periods.manage',
      'analytical_accounts.manage', 'analytical_accounts.read',
      'mobile.dashboard.view', 'mobile.tasks.view', 'mobile.customers.view', 'mobile.advances.view',
      'mobile.collections.view', 'mobile.followups.view', 'mobile.promises.view',
      'mobile.reservations.view', 'mobile.inventory.view', 'mobile.receipts.view',
      'mobile.location.view', 'mobile.notifications.view',
    ],
    'المحصل': [
      'customers.read', 'balances.read', 'followups.create', 'promises.create',
      'collections.create', 'tasks.manage', 'reservations.read', 'reservations.create',
      'reservations.deliver', 'reservations.extend',
      'mobile.dashboard.view', 'mobile.tasks.view', 'mobile.customers.view', 'mobile.advances.view',
      'mobile.tasks.create',
      'mobile.collections.view', 'mobile.collections.create', 'mobile.followups.view', 'mobile.followups.create',
      'mobile.promises.view', 'mobile.promises.create', 'mobile.reservations.view', 'mobile.reservations.create',
      'mobile.receipts.view', 'mobile.receipts.upload', 'mobile.location.view', 'mobile.location.update',
      'mobile.financial_adjustments.request', 'mobile.assignment_change.request',
      'mobile.notifications.view', 'mobile.messages.view',
    ],
    'المحاسب': [
      'customers.read', 'customers.read_all', 'customers.transfer', 'balances.read', 'collections.approve', 'imports.run',
      'imports.read', 'imports.reverse', 'reconciliation.review', 'reports.read', 'reports.export', 'risk.read',
      'reservations.read',
    ],
    'أمين الصندوق': ['cash.receive', 'collections.approve', 'balances.read'],
  };
  for (const [name, permCodes] of Object.entries(rolesDef)) {
    const role = await prisma.role.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {},
      create: { organizationId: org.id, name, isSystem: true },
    });
    for (const code of permCodes) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permId[code] } },
        update: {},
        create: { roleId: role.id, permissionId: permId[code] },
      });
    }
  }

  // ------------------------------------------------------------------ مستخدم المدير الأولي
  const adminRole = await prisma.role.findFirst({
    where: { organizationId: org.id, name: 'مدير النظام' },
  });
  const admin = await prisma.user.upsert({
    where: { organizationId_username: { organizationId: org.id, username: 'admin' } },
    update: {},
    create: {
      organizationId: org.id,
      branchId: branch.id,
      username: 'admin',
      fullName: 'مدير النظام',
      passwordHash: hashPassword(process.env.ADMIN_INITIAL_PASSWORD || 'ChangeMe!2026'),
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });

  console.log(`✅ Seed اكتمل: 3 عملات، 9 أنواع مستندات، 5 أدوار، ${permissions.length} صلاحية، منشأة + فرع + admin`);
  console.log('⚠️  غيّر كلمة مرور admin فور أول دخول (ADMIN_INITIAL_PASSWORD في .env)');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
