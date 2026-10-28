import { Prisma } from '@prisma/client';
import { createQueuedNotification } from './push-outbox';

/** Persist delivery with the assignment transaction, including assignments to the actor. */
export async function queueAssignmentNotification(tx: Prisma.TransactionClient, assignmentId: string) {
  const assignment = await tx.customerAssignment.findUniqueOrThrow({
    where: { id: assignmentId },
    include: {
      customer: { select: { id: true, name: true, externalCustomerCode: true, organizationId: true } },
      collector: { include: { user: { select: { organizationId: true } } } },
    },
  });
  if (assignment.effectiveTo || assignment.collector.user.organizationId !== assignment.customer.organizationId) {
    throw new Error('Cannot notify an inactive or cross-organization assignment');
  }
  // One stable event identity also allows safe recovery of a previously missed notification.
  const existing = await tx.notification.findUnique({ where: { id: assignment.id } });
  if (existing) {
    if (existing.userId !== assignment.collector.userId || existing.kind !== 'customer_transferred') {
      throw new Error('Assignment notification identity conflict');
    }
    return existing;
  }
  return createQueuedNotification(tx, {
    id: assignment.id,
    userId: assignment.collector.userId,
    kind: 'customer_transferred',
    payload: {
      assignmentId: assignment.id, customerId: assignment.customer.id,
      customerName: assignment.customer.name, customerCode: assignment.customer.externalCustomerCode,
      reason: assignment.reason, href: `/customers/${assignment.customer.id}`,
    },
  });
}
