import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './guards/jwt-auth.guard';

/**
 * أدوات نطاق المحصل المشتركة (القاعدة المعتمدة: المحصل يرى/يعمل على عملائه فقط):
 * - resolveCollector: يعيد سجل المحصل للمستخدم الحالي إن وُجد.
 * - canActOnCustomer: مالك customers.read_all يعمل على أي عميل بالمنشأة؛
 *   المحصل فقط على المسندين إليه حاليًا.
 */
export async function resolveCollector(prisma: PrismaService, user: AuthUser) {
  return prisma.collector.findUnique({ where: { userId: user.id } });
}

export async function assertCanActOnCustomer(
  prisma: PrismaService,
  user: AuthUser,
  customerId: string,
): Promise<{ collectorId: string | null }> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId: user.organizationId },
  });
  if (!customer) throw new ForbiddenException('العميل غير موجود في منشأتك');

  if (user.permissions.includes('customers.read_all')) {
    const own = await resolveCollector(prisma, user);
    return { collectorId: own?.id ?? null };
  }
  const collector = await resolveCollector(prisma, user);
  if (!collector) throw new ForbiddenException('حسابك ليس محصلاً ولا يملك رؤية شاملة');
  const assigned = await prisma.customerAssignment.findFirst({
    where: { customerId, collectorId: collector.id, effectiveTo: null },
  });
  if (!assigned) throw new ForbiddenException('العميل غير مسند إليك');
  return { collectorId: collector.id };
}

/** فلتر قوائم السجلات التشغيلية: المحصل يرى سجلاته، والمدير كل المنشأة. */
export async function operationalListScope(
  prisma: PrismaService,
  user: AuthUser,
): Promise<{ collectorId?: string; all: boolean }> {
  if (user.permissions.includes('customers.read_all')) return { all: true };
  const collector = await resolveCollector(prisma, user);
  if (!collector) return { all: false, collectorId: 'no-access' };
  return { all: false, collectorId: collector.id };
}
