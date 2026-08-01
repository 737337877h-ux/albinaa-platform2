import { PrismaService } from '../src/prisma/prisma.service';

/**
 * تنظيف شامل لبيانات عملاء الاختبار (9000x) مع تعطيل مؤقت لحماية Append-Only.
 * يحذف بالترتيب العكسي للعلاقات ثم يعيد تفعيل الحماية.
 * يجب أن يعمل في سياق beforeAll مع اتصال Prisma نشط.
 */
export async function cleanupTestCustomers(prisma: PrismaService) {
  const testCustomers = await prisma.customer.findMany({
    where: { externalCustomerCode: { startsWith: '900' } },
    select: { id: true },
  });
  const ids = testCustomers.map((c) => c.id);
  if (!ids.length) return;

  // تعطيل مؤقت لحماية Append-Only على collections و operational_ledger
  await prisma.$executeRawUnsafe(`ALTER TABLE collections DISABLE TRIGGER trg_collections_no_delete`);
  await prisma.$executeRawUnsafe(`ALTER TABLE operational_ledger DISABLE TRIGGER trg_ledger_immutable`);

  try {
    await prisma.balanceSnapshot.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.importedTransaction.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customerBalance.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.potentialDuplicateCustomer.deleteMany({
      where: { OR: [{ customerAId: { in: ids } }, { customerBId: { in: ids } }] },
    });
    await prisma.collection.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.operationalLedger.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.followup.deleteMany({ where: { customerId: { in: ids } } });
    // task يُحذف قبل paymentPromise لأن sourcePromiseId يُشير لـ promise
    // نحذف المهام المرتبطة بالوعود أولاً (بعضها قد يكون بلا customerId)
    const promiseIds = (await prisma.paymentPromise.findMany({
      where: { customerId: { in: ids } }, select: { id: true },
    })).map((p) => p.id);
    if (promiseIds.length) {
      await prisma.task.deleteMany({ where: { sourcePromiseId: { in: promiseIds } } });
    }
    await prisma.task.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.paymentPromise.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.reservation.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customerScore.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.balanceReconciliation.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customerAssignment.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customerCreditPolicy.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { id: { in: ids } } });
    // لا نحذف كل import_jobs (قد تشير لها أرصدة عملاء حقيقيين في بيئة تطوير مشتركة) —
    // نحذف فقط الوظائف غير المرتبطة بأي بيانات بعد تنظيف عملاء الاختبار
    await prisma.$executeRawUnsafe(`
      DELETE FROM import_jobs j
      WHERE NOT EXISTS (
        SELECT 1 FROM balance_snapshots      b WHERE b.import_job_id = j.id
        UNION ALL
        SELECT 1 FROM imported_transactions  t WHERE t.import_job_id = j.id
        UNION ALL
        SELECT 1 FROM balance_reconciliations r WHERE r.import_job_id = j.id
        UNION ALL
        SELECT 1 FROM debt_aging_summary     a WHERE a.import_job_id = j.id
        UNION ALL
        SELECT 1 FROM debt_aging_details     d WHERE d.import_job_id = j.id
      )
    `);
  } finally {
    // إعادة تفعيل الحماية دائمًا حتى لو حدث خطأ
    await prisma.$executeRawUnsafe(`ALTER TABLE operational_ledger ENABLE TRIGGER trg_ledger_immutable`);
    await prisma.$executeRawUnsafe(`ALTER TABLE collections ENABLE TRIGGER trg_collections_no_delete`);
  }
}
