import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { IssueReservationDto } from './dto/issue-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { CreateUnitDto, UpdateUnitDto } from './dto/manage-unit.dto';
import { RESERVATION_ITEM_STANDARDS } from './reservation-catalog';

export function reservationWeightTons(quantity: number, weightKg: number | null): number | null {
  return weightKg === null ? null : quantity * weightKg / 1000;
}

export function reservationAverageTonPrice(totalAmount: number, totalTons: number): number | null {
  return totalTons > 0 ? totalAmount / totalTons : null;
}

// Goods reservations: operational tracking only.
// Never touches customer accountingBalance/operationalBalance or collections —
// issuing only moves quantity between issuedQty/remainingQty on the reservation itself.
@Injectable()
export class ReservationsService {
  private readonly summaryCache = new Map<string, { expiresAt: number; value: unknown }>();

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

  private invalidateSummary(organizationId: string) {
    this.summaryCache.delete(organizationId);
  }

  private async resolveUnit(unitId?: string, legacyUnit?: string) {
    const unit = unitId
      ? await this.prisma.unit.findFirst({ where: { id: unitId, isActive: true } })
      : legacyUnit
        ? await this.prisma.unit.findFirst({
            where: {
              isActive: true,
              OR: [
                { code: { equals: legacyUnit.trim(), mode: 'insensitive' } },
                { nameAr: { equals: legacyUnit.trim(), mode: 'insensitive' } },
              ],
            },
          })
        : null;
    if (!unit) throw new BadRequestException('اختر وحدة قياس معتمدة ونشطة');
    return unit;
  }

  async listUnits() {
    const rows = await this.prisma.unit.findMany({
      where: { isActive: true },
      orderBy: [{ weightKg: 'desc' }, { nameAr: 'asc' }],
    });
    return rows.map((unit) => ({
      id: unit.id,
      code: unit.code,
      nameAr: unit.nameAr,
      weightKg: unit.weightKg === null ? null : Number(unit.weightKg),
    }));
  }

  approvedItems() {
    return RESERVATION_ITEM_STANDARDS;
  }

  async listAllUnits() {
    const rows = await this.prisma.unit.findMany({
      orderBy: [{ isActive: 'desc' }, { weightKg: 'desc' }, { nameAr: 'asc' }],
      include: { _count: { select: { reservations: true } } },
    });
    return rows.map((unit) => ({
      id: unit.id,
      code: unit.code,
      nameAr: unit.nameAr,
      weightKg: unit.weightKg === null ? null : Number(unit.weightKg),
      isActive: unit.isActive,
      reservationsCount: unit._count.reservations,
    }));
  }

  async createUnit(actor: AuthUser, dto: CreateUnitDto, req: Request) {
    const code = dto.code.trim().toUpperCase();
    const nameAr = dto.nameAr.trim();
    if (!code || !nameAr) throw new BadRequestException('رمز الوحدة واسمها مطلوبان');
    const existing = await this.prisma.unit.findUnique({ where: { code } });
    if (existing) throw new ConflictException('رمز الوحدة مستخدم مسبقًا');
    const unit = await this.prisma.unit.create({
      data: { code, nameAr, weightKg: dto.weightKg ?? null },
    });
    await this.audit.log({
      userId: actor.id, action: 'reservation_unit_created', entityTable: 'units', entityId: unit.id,
      newValue: { code: unit.code, nameAr: unit.nameAr, weightKg: unit.weightKg }, req,
    });
    return { ...unit, weightKg: unit.weightKg === null ? null : Number(unit.weightKg), reservationsCount: 0 };
  }

  async updateUnit(actor: AuthUser, id: string, dto: UpdateUnitDto, req: Request) {
    const before = await this.prisma.unit.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('وحدة القياس غير موجودة');
    const code = dto.code === undefined ? undefined : dto.code.trim().toUpperCase();
    const nameAr = dto.nameAr === undefined ? undefined : dto.nameAr.trim();
    if (code === '' || nameAr === '') throw new BadRequestException('رمز الوحدة واسمها لا يمكن أن يكونا فارغين');
    if (code && code !== before.code) {
      const existing = await this.prisma.unit.findUnique({ where: { code } });
      if (existing) throw new ConflictException('رمز الوحدة مستخدم مسبقًا');
    }
    const unit = await this.prisma.unit.update({
      where: { id },
      data: {
        ...(code !== undefined ? { code } : {}),
        ...(nameAr !== undefined ? { nameAr } : {}),
        ...(dto.weightKg !== undefined ? { weightKg: dto.weightKg } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: { _count: { select: { reservations: true } } },
    });
    await this.audit.log({
      userId: actor.id, action: 'reservation_unit_updated', entityTable: 'units', entityId: unit.id,
      oldValue: { code: before.code, nameAr: before.nameAr, weightKg: before.weightKg, isActive: before.isActive },
      newValue: { code: unit.code, nameAr: unit.nameAr, weightKg: unit.weightKg, isActive: unit.isActive }, req,
    });
    return {
      ...unit,
      weightKg: unit.weightKg === null ? null : Number(unit.weightKg),
      reservationsCount: unit._count.reservations,
    };
  }

  async summary(actor: AuthUser) {
    const cached = this.summaryCache.get(actor.organizationId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const rows = await this.prisma.$queryRaw<Array<{
      active_count: bigint;
      customer_count: bigint;
      total_tons: Prisma.Decimal;
      expiring_in_7_days: bigint;
      totals_by_currency: Array<{ currency: string; amount: number | string }>;
      ton_price_basis_by_currency: Array<{
        currency: string;
        totalAmount: number | string;
        totalTons: number | string;
      }>;
      unweighted_units: Array<{ unitName: string; qty: number | string }>;
    }>>(Prisma.sql`
      WITH active AS (
        SELECT
          r.customer_id,
          r.currency_code,
          COALESCE(r.remaining_qty, r.quantity, 0) AS qty,
          COALESCE(r.remaining_tons, COALESCE(r.remaining_qty, r.quantity, 0) * u.weight_kg / 1000, 0) AS tons,
          COALESCE(r.unit_price, 0) AS unit_price,
          r.expires_at,
          u.name_ar AS unit_name,
          u.weight_kg
        FROM reservations r
        JOIN customers c ON c.id = r.customer_id
        LEFT JOIN units u ON u.id = r.unit_id
        WHERE c.organization_id = ${actor.organizationId}::uuid
          AND r.status IN ('open', 'partial')
          AND (r.expires_at IS NULL OR r.expires_at >= CURRENT_DATE)
      )
      SELECT
        (SELECT COUNT(*) FROM active) AS active_count,
        (SELECT COUNT(DISTINCT customer_id) FROM active) AS customer_count,
        (SELECT COALESCE(SUM(tons), 0) FROM active) AS total_tons,
        (SELECT COUNT(*) FROM active WHERE expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 7) AS expiring_in_7_days,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', currency_code, 'amount', amount) ORDER BY currency_code), '[]'::jsonb)
          FROM (SELECT currency_code, SUM(qty * unit_price) AS amount FROM active GROUP BY currency_code) currency_totals
        ) AS totals_by_currency,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'currency', currency_code,
            'totalAmount', total_amount,
            'totalTons', total_tons
          ) ORDER BY currency_code), '[]'::jsonb)
          FROM (
            SELECT
              currency_code,
              SUM(qty * unit_price) AS total_amount,
              SUM(tons) AS total_tons
            FROM active
            WHERE weight_kg IS NOT NULL
            GROUP BY currency_code
          ) ton_price_basis
        ) AS ton_price_basis_by_currency,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('unitName', unit_name, 'qty', qty) ORDER BY unit_name), '[]'::jsonb)
          FROM (SELECT COALESCE(unit_name, 'بانتظار التصنيف') AS unit_name, SUM(qty) AS qty FROM active WHERE weight_kg IS NULL GROUP BY COALESCE(unit_name, 'بانتظار التصنيف')) unweighted
        ) AS unweighted_units
    `);
    const row = rows[0];
    const value = {
      activeCount: Number(row.active_count),
      customerCount: Number(row.customer_count),
      totalTons: Number(row.total_tons),
      totalsByCurrency: (row.totals_by_currency ?? []).map((item) => ({
        currency: item.currency,
        amount: Number(item.amount),
      })),
      averageTonPriceByCurrency: (row.ton_price_basis_by_currency ?? []).map((item) => ({
        currency: item.currency,
        averageTonPrice: reservationAverageTonPrice(Number(item.totalAmount), Number(item.totalTons)) ?? 0,
        totalTons: Number(item.totalTons),
      })),
      unweightedUnits: (row.unweighted_units ?? []).map((item) => ({
        unitName: item.unitName,
        qty: Number(item.qty),
      })),
      expiringIn7Days: Number(row.expiring_in_7_days),
    };
    this.summaryCache.set(actor.organizationId, { expiresAt: Date.now() + 60_000, value });
    return value;
  }

  async findAll(actor: AuthUser, customerId?: string) {
    const rows = await this.prisma.reservation.findMany({
      where: {
        customer: { organizationId: actor.organizationId },
        ...(customerId ? { customerId } : {}),
      },
      include: {
        measureUnit: true,
        adjustments: { orderBy: { createdAt: 'desc' }, take: 30 },
        customer: {
          select: {
            id: true,
            name: true,
            externalCustomerCode: true,
            assignments: {
              where: { effectiveTo: null },
              take: 1,
              select: { collector: { select: { user: { select: { fullName: true } } } } },
            },
          },
        },
      },
      orderBy: { reservedAt: 'desc' },
    });
    return rows.map((row) => ['cancelled', 'completed', 'fulfilled'].includes(row.status)
      ? { ...row, remainingQty: new Prisma.Decimal(0), remainingTons: new Prisma.Decimal(0) }
      : row);
  }

  async searchCustomerOptions(actor: AuthUser, rawSearch: string) {
    const search = rawSearch.trim();
    if (search.length < 2) {
      throw new BadRequestException('اكتب حرفين على الأقل للبحث عن العميل');
    }
    const normalized = search
      .normalize('NFKC')
      .replace(/[إأآا]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, ' ')
      .trim();
    const rows = await this.prisma.customer.findMany({
      where: {
        organizationId: actor.organizationId,
        status: { notIn: ['merged', 'import_reversed'] },
        OR: [{ customerType: null }, { customerType: { not: 'advance' } }],
        AND: [{
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { nameNormalized: { contains: normalized } },
            { tradeName: { contains: search, mode: 'insensitive' } },
            { externalCustomerCode: { contains: search, mode: 'insensitive' } },
            { accountNumber: { contains: search, mode: 'insensitive' } },
            { phonePrimary: { contains: search } },
            { phoneSecondary: { contains: search } },
            { whatsapp: { contains: search } },
          ],
        }],
      },
      take: 20,
      select: {
        id: true,
        name: true,
        externalCustomerCode: true,
        accountNumber: true,
      },
    });
    rows.sort((left, right) => {
      const leftCode = left.externalCustomerCode ?? left.accountNumber ?? '';
      const rightCode = right.externalCustomerCode ?? right.accountNumber ?? '';
      const leftExact = leftCode.toLowerCase() === search.toLowerCase() ? 0 : 1;
      const rightExact = rightCode.toLowerCase() === search.toLowerCase() ? 0 : 1;
      return leftExact - rightExact || left.name.localeCompare(right.name, 'ar');
    });
    return { items: rows.slice(0, 10) };
  }

  async findOne(actor: AuthUser, id: string) {
    return this.findScoped(actor, id);
  }

  async create(actor: AuthUser, dto: CreateReservationDto, req?: Request) {
    await this.assertCustomerInOrg(actor, dto.customerId);
    const currencyCode = dto.currencyCode.trim().toUpperCase();
    const currency = await this.prisma.currency.findUnique({ where: { code: currencyCode } });
    if (!currency) throw new BadRequestException('عملة النظام الأساسية غير مهيأة');
    const tonUnit = dto.unitId || dto.unit
      ? await this.resolveUnit(dto.unitId, dto.unit)
      : await this.prisma.unit.findFirst({
          where: { isActive: true, OR: [{ code: { in: ['TON', 'T'] } }, { nameAr: { contains: 'طن' } }] },
          orderBy: { code: 'asc' },
        });

    const reservation = await this.prisma.reservation.create({
      data: {
        customerId: dto.customerId,
        // Legacy required column from the pre-PR-F credit-reservation shape — unused by goods
        // reservations, kept at 0 rather than relaxing the NOT NULL constraint on old data.
        creditAmount: 0,
        itemName: dto.itemName?.trim() || null,
        itemType: dto.itemType?.trim() || 'aggregate_tons',
        quantity: dto.totalTons,
        unit: tonUnit?.nameAr ?? 'طن',
        unitId: tonUnit?.id ?? null,
        unitPrice: dto.unitPrice,
        totalAmount: dto.totalTons * dto.unitPrice,
        remainingQty: dto.totalTons,
        totalTons: dto.totalTons,
        remainingTons: dto.totalTons,
        currencyCode,
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
        customerId: dto.customerId,
        totalTons: dto.totalTons,
        unitPrice: dto.unitPrice,
        totalAmount: dto.totalTons * dto.unitPrice,
        currencyCode,
        unit: 'طن',
        approvedItemAssignment: 'deferred_until_sales_invoice',
      },
      req,
    });
    this.invalidateSummary(actor.organizationId);
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
    this.invalidateSummary(actor.organizationId);
    return reservation;
  }

  async issue(actor: AuthUser, id: string, dto: IssueReservationDto, req?: Request) {
    const before = await this.findScoped(actor, id);
    if (before.status === 'cancelled' || before.status === 'completed') {
      throw new BadRequestException(`Reservation is not open for issuing (status: "${before.status}")`);
    }
    const remaining = Number(before.remainingTons ?? before.remainingQty ?? before.quantity ?? 0);
    if (dto.qty > remaining) {
      throw new BadRequestException(`Issue quantity (${dto.qty}) exceeds remaining quantity (${remaining})`);
    }

    const newIssuedQty = Number(before.issuedQty) + dto.qty;
    const newRemainingQty = remaining - dto.qty;
    const newStatus = newRemainingQty === 0 ? 'completed' : 'partial';

    const reservation = await this.prisma.reservation.update({
      where: { id },
      data: {
        issuedQty: newIssuedQty,
        remainingQty: newRemainingQty,
        remainingTons: newRemainingQty,
        status: newStatus,
      },
    });

    await this.audit.log({
      userId: actor.id, action: 'reservation_issued', entityTable: 'reservations', entityId: id,
      oldValue: { issuedQty: Number(before.issuedQty), remainingQty: remaining, status: before.status },
      newValue: { qty: dto.qty, issuedQty: newIssuedQty, remainingQty: newRemainingQty, status: newStatus },
      req,
    });
    this.invalidateSummary(actor.organizationId);
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
    this.invalidateSummary(actor.organizationId);
    return reservation;
  }
}
