// ============================================================================
// Seed — البيانات المرجعية الأولية (Sprint 1)
// يعتمد على نتائج التحليل الفعلي لملف عملاء_تحليلي_16-07-2026.xlsx:
// - 3 عملات مكتشفة (YER / SAR / USD)
// - 9 أنواع مستندات مكتشفة مع أثرها المرصود من 7,102 حركة حقيقية
// - الأدوار الخمسة من مستند المتطلبات + صلاحيات أساسية
// تشغيل: npx prisma db seed   (idempotent — آمن لإعادة التشغيل)
// ============================================================================
const { PrismaClient } = require('@prisma/client');
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
    ['reconciliation.review', 'مراجعة واعتماد التسويات'],
    ['reports.read', 'عرض التقارير'],
    ['reports.export', 'تصدير التقارير'],
    ['users.manage', 'إدارة المستخدمين والصلاحيات'],
    ['settings.manage', 'إدارة الإعدادات'],
    ['audit.read', 'عرض سجل التدقيق'],
    ['duplicates.review', 'مراجعة حالات تشابه العملاء'],
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
      'promises.create', 'tasks.manage', 'reports.read', 'reports.export', 'duplicates.review',
    ],
    'المحصل': [
      'customers.read', 'balances.read', 'followups.create', 'promises.create',
      'collections.create', 'tasks.manage',
    ],
    'المحاسب': [
      'customers.read', 'customers.read_all', 'balances.read', 'collections.approve', 'imports.run',
      'imports.read', 'reconciliation.review', 'reports.read', 'reports.export',
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

  console.log('✅ Seed اكتمل: 3 عملات، 9 أنواع مستندات، 5 أدوار، 20 صلاحية، منشأة + فرع + admin');
  console.log('⚠️  غيّر كلمة مرور admin فور أول دخول (ADMIN_INITIAL_PASSWORD في .env)');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
