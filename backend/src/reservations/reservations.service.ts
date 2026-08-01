import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { IssueReservationDto } from './dto/issue-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';

// Goods reservations: operational tracking only.
// Never touches customer accountingBalance/operationalBalance or collections —
// issuing only moves quantity between issuedQty/remainingQty on the reservation itself.
@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async assertCustomerInOrg(actor: AuthUser, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: actor.organizationId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
  }

  private async findScoped(actor: AuthUser, id: string) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id, customer: { organizationId: actor.organizationId } },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');
    return reservation;
  }

  async findAll(actor: AuthUser, customerId?: string) {
    return this.prisma.reservation.findMany({
      where: {
        customer: { organizationId: actor.organizationId },
        ...(customerId ? { customerId } : {}),
      },
      orderBy: { reservedAt: 'desc' },
    });
  }

  async findOne(actor: AuthUser, id: string) {
    return this.findScoped(actor, id);
  }

  async create(actor: AuthUser, dto: CreateReservationDto, req?: Request) {
    await this.assertCustomerInOrg(actor, dto.customerId);

    const currency = await this.prisma.currency.findUnique({ where: { code: dto.currencyCode } });
    if (!currency) throw new BadRequestException('Unknown currency code');

    const totalAmount = dto.quantity * dto.unitPrice;

    const reservation = await this.prisma.reservation.create({
      data: {
        customerId: dto.customerId,
        // Legacy required column from the pre-PR-F credit-reservation shape — unused by goods
        // reservations, kept at 0 rather than relaxing the NOT NULL constraint on old data.
        creditAmount: 0,
        itemName: dto.itemName,
        itemType: dto.itemType,
        quantity: dto.quantity,
        unit: dto.unit,
        unitPrice: dto.unitPrice,
        totalAmount,
        remainingQty: dto.quantity,
        currencyCode: dto.currencyCode,
        warehouse: dto.warehouse,
        documentNumber: dto.documentNumber,
        notes: dto.notes,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdBy: actor.id,
      },
    });

    await this.audit.log({
      userId: actor.id, action: 'reservation_created', entityTable: 'reservations', entityId: reservation.id,
      newValue: {
        customerId: dto.customerId, itemName: dto.itemName, quantity: dto.quantity,
        unit: dto.unit, unitPrice: dto.unitPrice, totalAmount, currencyCode: dto.currencyCode,
      },
      req,
    });
    return reservation;
  }

  async update(actor: AuthUser, id: string, dto: UpdateReservationDto, req?: Request) {
    const before = await this.findScoped(actor, id);
    if (before.status === 'cancelled' || before.status === 'completed') {
      throw new BadRequestException(`Cannot edit a reservation with status "${before.status}"`);
    }

    const reservation = await this.prisma.reservation.update({
      where: { id },
      data: {
        warehouse: dto.warehouse,
        documentNumber: dto.documentNumber,
        notes: dto.notes,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });

    await this.audit.log({
      userId: actor.id, action: 'reservation_updated', entityTable: 'reservations', entityId: id,
      oldValue: { warehouse: before.warehouse, documentNumber: before.documentNumber, notes: before.notes },
      newValue: dto, req,
    });
    return reservation;
  }

  async issue(actor: AuthUser, id: string, dto: IssueReservationDto, req?: Request) {
    const before = await this.findScoped(actor, id);
    if (before.status === 'cancelled' || before.status === 'completed') {
      throw new BadRequestException(`Reservation is not open for issuing (status: "${before.status}")`);
    }
    const remaining = Number(before.remainingQty);
    if (dto.qty > remaining) {
      throw new BadRequestException(`Issue quantity (${dto.qty}) exceeds remaining quantity (${remaining})`);
    }

    const newIssuedQty = Number(before.issuedQty) + dto.qty;
    const newRemainingQty = remaining - dto.qty;
    const newStatus = newRemainingQty === 0 ? 'completed' : 'partial';

    const reservation = await this.prisma.reservation.update({
      where: { id },
      data: { issuedQty: newIssuedQty, remainingQty: newRemainingQty, status: newStatus },
    });

    await this.audit.log({
      userId: actor.id, action: 'reservation_issued', entityTable: 'reservations', entityId: id,
      oldValue: { issuedQty: Number(before.issuedQty), remainingQty: remaining, status: before.status },
      newValue: { qty: dto.qty, issuedQty: newIssuedQty, remainingQty: newRemainingQty, status: newStatus },
      req,
    });
    return reservation;
  }

  async cancel(actor: AuthUser, id: string, req?: Request) {
    const before = await this.findScoped(actor, id);
    if (before.status === 'completed') {
      throw new BadRequestException('Cannot cancel a completed reservation');
    }
    if (before.status === 'cancelled') {
      throw new ConflictException('Reservation is already cancelled');
    }

    const reservation = await this.prisma.reservation.update({
      where: { id },
      data: { status: 'cancelled' },
    });

    await this.audit.log({
      userId: actor.id, action: 'reservation_cancelled', entityTable: 'reservations', entityId: id,
      oldValue: { status: before.status }, req,
    });
    return reservation;
  }
}
