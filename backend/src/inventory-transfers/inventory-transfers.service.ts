import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInventoryTransferDto, ReviewInventoryTransferDto } from './dto/inventory-transfer.dto';
import { OracleInventoryReader } from './oracle-inventory.reader';
import { TransferValidationIssue, validateStockLine } from './inventory-transfer.validation';

const EDITABLE_STATUSES = ['draft', 'rejected'] as const;

@Injectable()
export class InventoryTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly oracle: OracleInventoryReader,
  ) {}

  private include = { lines: { orderBy: { lineNo: 'asc' as const } } };

  private async scoped(actor: AuthUser, id: string) {
    const row = await this.prisma.inventoryTransferRequest.findFirst({
      where: { id, organizationId: actor.organizationId }, include: this.include,
    });
    if (!row) throw new NotFoundException('طلب التحويل غير موجود');
    return row;
  }

  list(actor: AuthUser) {
    return this.prisma.inventoryTransferRequest.findMany({
      where: { organizationId: actor.organizationId }, include: this.include,
      orderBy: { createdAt: 'desc' },
    });
  }

  get(actor: AuthUser, id: string) { return this.scoped(actor, id); }

  async create(actor: AuthUser, dto: CreateInventoryTransferDto, req: Request) {
    const source = dto.sourceWarehouseCode.trim();
    const destination = dto.destinationWarehouseCode.trim();
    if (source === destination) throw new BadRequestException('يجب أن يختلف المستودع المصدر عن الوجهة');
    const key = dto.idempotencyKey.trim();
    const existing = await this.prisma.inventoryTransferRequest.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: actor.organizationId, idempotencyKey: key } },
      include: this.include,
    });
    if (existing) {
      const same = existing.sourceWarehouseCode === source
        && existing.destinationWarehouseCode === destination
        && existing.oracleSourceTransferSerial === (dto.oracleSourceTransferSerial?.trim() || null)
        && existing.lines.length === dto.lines.length
        && existing.lines.every((line, index) => line.itemCode === dto.lines[index].itemCode.trim()
          && line.unitCode === dto.lines[index].unitCode.trim()
          && Number(line.quantity) === dto.lines[index].quantity);
      if (!same) throw new ConflictException('مفتاح منع التكرار مستخدم لطلب مختلف');
      return existing;
    }
    const created = await this.prisma.inventoryTransferRequest.create({
      data: {
        organizationId: actor.organizationId, idempotencyKey: key,
        sourceWarehouseCode: source, destinationWarehouseCode: destination,
        oracleSourceTransferSerial: dto.oracleSourceTransferSerial?.trim() || null,
        notes: dto.notes?.trim() || null, createdBy: actor.id,
        lines: { create: dto.lines.map((line, index) => ({
          lineNo: index + 1, itemCode: line.itemCode.trim(), unitCode: line.unitCode.trim(), quantity: line.quantity,
        })) },
      }, include: this.include,
    });
    await this.audit.log({ userId: actor.id, action: 'inventory_transfer_created', entityTable: 'inventory_transfer_requests', entityId: created.id, newValue: { idempotencyKey: key, source, destination }, req });
    return created;
  }

  async submit(actor: AuthUser, id: string, req: Request) {
    const row = await this.scoped(actor, id);
    if (!(EDITABLE_STATUSES as readonly string[]).includes(row.status)) throw new ConflictException('حالة الطلب لا تسمح بالإرسال للاعتماد');
    const updated = await this.prisma.inventoryTransferRequest.update({
      where: { id }, data: { status: 'pending_approval', submittedBy: actor.id, submittedAt: new Date(), reviewedBy: null, reviewedAt: null, reviewNote: null },
      include: this.include,
    });
    await this.audit.log({ userId: actor.id, action: 'inventory_transfer_submitted', entityTable: 'inventory_transfer_requests', entityId: id, req });
    return updated;
  }

  async dryRun(actor: AuthUser, id: string, req?: Request) {
    const row = await this.scoped(actor, id);
    const issues: TransferValidationIssue[] = [];
    if (row.sourceWarehouseCode === row.destinationWarehouseCode) issues.push({ code: 'SAME_WAREHOUSE', severity: 'error', message: 'المصدر والوجهة متطابقان' });
    const [sourceExists, destinationExists] = await Promise.all([
      this.oracle.warehouseExists(row.sourceWarehouseCode), this.oracle.warehouseExists(row.destinationWarehouseCode),
    ]);
    if (!sourceExists) issues.push({ code: 'SOURCE_WAREHOUSE_NOT_FOUND', severity: 'error', message: 'المستودع المصدر غير موجود في Oracle' });
    if (!destinationExists) issues.push({ code: 'DESTINATION_WAREHOUSE_NOT_FOUND', severity: 'error', message: 'المستودع الوجهة غير موجود في Oracle' });
    const snapshots = await Promise.all(row.lines.map((line) => this.oracle.stock(row.sourceWarehouseCode, line.itemCode, line.unitCode)));
    row.lines.forEach((line, index) => issues.push(...validateStockLine(line.lineNo, Number(line.quantity), snapshots[index])));
    const oracleTransferStatus = row.oracleSourceTransferSerial
      ? await this.oracle.transferStatus({
        sourceTransferSerial: row.oracleSourceTransferSerial,
        sourceWarehouseCode: row.sourceWarehouseCode,
        destinationWarehouseCode: row.destinationWarehouseCode,
        itemCodes: row.lines.map((line) => line.itemCode),
      })
      : null;
    const result = {
      mode: 'DRY_RUN', oracleWriteAttempted: false, valid: issues.every((issue) => issue.severity !== 'error'),
      checkedAt: new Date().toISOString(), screen: 'INVT001.225', sourceWarehouseCode: row.sourceWarehouseCode,
      destinationWarehouseCode: row.destinationWarehouseCode,
      lines: row.lines.map((line, index) => ({
        lineNo: line.lineNo, itemCode: line.itemCode, unitCode: line.unitCode,
        quantity: Number(line.quantity), packageSize: snapshots[index].packageSize,
        availableQuantity: snapshots[index].availableQuantity,
      })),
      issues,
      oracleTransferStatus,
    };
    await this.prisma.inventoryTransferRequest.update({
      where: { id },
      data: {
        lastDryRunAt: new Date(),
        lastDryRunResult: result as unknown as Prisma.InputJsonValue,
        ...(oracleTransferStatus ? {
          oracleTransferDocumentNumber: oracleTransferStatus.transferDocumentNumber,
          oracleDestinationTransferSerial: oracleTransferStatus.destinationTransferSerial,
          sourceIssued: oracleTransferStatus.sourceIssued,
          destinationReceived: oracleTransferStatus.destinationReceived,
          transferCompleted: oracleTransferStatus.transferCompleted,
          lastOracleCheckedAt: new Date(),
        } : {}),
      },
    });
    await this.audit.log({ userId: actor.id, action: 'inventory_transfer_dry_run', entityTable: 'inventory_transfer_requests', entityId: id, newValue: { valid: result.valid, issueCodes: issues.map((issue) => issue.code), oracleWriteAttempted: false }, req });
    return result;
  }

  async approve(actor: AuthUser, id: string, dto: ReviewInventoryTransferDto, req: Request) {
    const row = await this.scoped(actor, id);
    if (row.status !== 'pending_approval') throw new ConflictException('الطلب ليس بانتظار الاعتماد');
    if (row.createdBy === actor.id) throw new ConflictException('لا يجوز لمنشئ الطلب اعتماده');
    const check = await this.dryRun(actor, id, req);
    if (!check.valid) throw new BadRequestException({ message: 'تعذر الاعتماد بسبب فشل التحقق من Oracle أو عدم كفاية الرصيد', issues: check.issues });
    const updated = await this.prisma.inventoryTransferRequest.update({
      where: { id }, data: { status: 'approved', reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: dto.note?.trim() || null }, include: this.include,
    });
    await this.audit.log({ userId: actor.id, action: 'inventory_transfer_approved_dry_run', entityTable: 'inventory_transfer_requests', entityId: id, req });
    return updated;
  }

  async reject(actor: AuthUser, id: string, dto: ReviewInventoryTransferDto, req: Request) {
    const row = await this.scoped(actor, id);
    if (row.status !== 'pending_approval') throw new ConflictException('الطلب ليس بانتظار الاعتماد');
    if (!dto.note?.trim()) throw new BadRequestException('سبب الرفض مطلوب');
    const updated = await this.prisma.inventoryTransferRequest.update({ where: { id }, data: { status: 'rejected', reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: dto.note.trim() }, include: this.include });
    await this.audit.log({ userId: actor.id, action: 'inventory_transfer_rejected', entityTable: 'inventory_transfer_requests', entityId: id, reason: dto.note, req });
    return updated;
  }

  async refreshOracleStatus(actor: AuthUser, id: string, req: Request) {
    const row = await this.scoped(actor, id);
    if (!row.oracleSourceTransferSerial) {
      throw new BadRequestException('رقم TR_SER للمستند المصدر مطلوب لقراءة حالة Oracle');
    }
    const status = await this.oracle.transferStatus({
      sourceTransferSerial: row.oracleSourceTransferSerial,
      sourceWarehouseCode: row.sourceWarehouseCode,
      destinationWarehouseCode: row.destinationWarehouseCode,
      itemCodes: row.lines.map((line) => line.itemCode),
    });
    if (!status) return { found: false, request: row };
    if (status.destinationReceived && !status.sourceIssued) throw new ConflictException('Oracle أعاد طرف وجهة بلا طرف مصدر مرتبط');
    if (status.transferCompleted !== (status.sourceIssued && status.destinationReceived)) {
      throw new ConflictException('حالة اكتمال التحويل لا تطابق وجود طرفي المصدر والوجهة');
    }
    const updated = await this.prisma.inventoryTransferRequest.update({
      where: { id }, data: {
        oracleOutReqSer: status.outReqSer, oracleTransferDocumentNumber: status.transferDocumentNumber,
        oracleSourceTransferSerial: status.sourceTransferSerial,
        oracleDestinationTransferSerial: status.destinationTransferSerial,
        sourceIssued: status.sourceIssued, destinationReceived: status.destinationReceived,
        transferCompleted: status.transferCompleted, lastOracleCheckedAt: new Date(),
      }, include: this.include,
    });
    await this.audit.log({ userId: actor.id, action: 'inventory_transfer_oracle_status_read', entityTable: 'inventory_transfer_requests', entityId: id, newValue: status, req });
    return { found: true, request: updated };
  }
}
