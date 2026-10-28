import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { OracleInventoryItemsQueryDto } from '../oracle-inventory-sync/dto/oracle-inventory-query.dto';
import { OracleInventoryReadService } from '../oracle-inventory-sync/oracle-inventory-read.service';
import {
  CreateInventoryTransferDto,
  LinkOracleTransferDocumentDto,
  ReviewInventoryTransferDto,
} from './dto/inventory-transfer.dto';
import { OracleInventoryReader } from './oracle-inventory.reader';
import { OracleOutRequestWriter } from './oracle-out-request.writer';
import { TransferValidationIssue, validateStockLine } from './inventory-transfer.validation';

const EDITABLE_STATUSES = ['draft', 'rejected'] as const;

@Injectable()
export class InventoryTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly oracle: OracleInventoryReader,
    private readonly inventoryMirror: OracleInventoryReadService,
    private readonly oracleWriter: OracleOutRequestWriter,
  ) {}

  private include = { lines: { orderBy: { lineNo: 'asc' as const } } };

  private async scoped(actor: AuthUser, id: string) {
    const row = await this.prisma.inventoryTransferRequest.findFirst({
      where: { id, organizationId: actor.organizationId }, include: this.include,
    });
    if (!row) throw new NotFoundException('طلب التحويل غير موجود');
    return row;
  }

  private async attachItemNames<T extends { lines: Array<{ itemCode: string }> }>(actor: AuthUser, rows: T[]) {
    const itemCodes = rows.flatMap((row) => row.lines.map((line) => line.itemCode));
    const labels = this.oracle.directLookupsEnabled()
      ? await this.oracle.directItemLabels(itemCodes)
      : await this.inventoryMirror.itemLabels(actor, itemCodes);
    const names = new Map(labels.map((item) => [item.externalItemCode, item.nameAr]));
    return rows.map((row) => ({
      ...row,
      lines: row.lines.map((line) => ({ ...line, itemName: names.get(line.itemCode) ?? null })),
    }));
  }

  async list(actor: AuthUser) {
    const rows = await this.prisma.inventoryTransferRequest.findMany({
      where: { organizationId: actor.organizationId }, include: this.include,
      orderBy: { createdAt: 'desc' },
    });
    return this.attachItemNames(actor, rows);
  }

  warehouseOptions(actor: AuthUser) {
    return this.oracle.directLookupsEnabled()
      ? this.oracle.directWarehouses()
      : this.inventoryMirror.warehouses(actor, { status: 'active' });
  }

  itemOptions(actor: AuthUser, query: OracleInventoryItemsQueryDto) {
    const limit = Math.min(query.limit ?? 20, 20);
    return this.oracle.directLookupsEnabled()
      ? this.oracle.directItems(query.search, limit)
      : this.inventoryMirror.items(actor, {
      ...query,
      page: 1,
      limit,
      status: 'active',
    });
  }

  itemOption(actor: AuthUser, externalItemCode: string) {
    return this.oracle.directLookupsEnabled()
      ? this.oracle.directItem(externalItemCode)
      : this.inventoryMirror.item(actor, externalItemCode, {});
  }

  async get(actor: AuthUser, id: string) {
    const [row] = await this.attachItemNames(actor, [await this.scoped(actor, id)]);
    return row;
  }

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
    const allowInsufficientStock = this.oracleWriter.allowsInsufficientStock() && this.oracle.directLookupsEnabled();
    row.lines.forEach((line, index) => issues.push(...validateStockLine(
      line.lineNo, Number(line.quantity), snapshots[index], allowInsufficientStock,
    )));
    const oracleTransferStatus = row.oracleSourceTransferSerial
      ? await this.oracle.transferStatus({
        sourceTransferSerial: row.oracleSourceTransferSerial,
        sourceWarehouseCode: row.sourceWarehouseCode,
        destinationWarehouseCode: row.destinationWarehouseCode,
        itemCodes: row.lines.map((line) => line.itemCode),
      })
      : null;
    const result = {
      mode: 'DRY_RUN', oracleWriteAttempted: false, allowInsufficientStock,
      valid: issues.every((issue) => issue.severity !== 'error'),
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
    if (!check.valid) throw new BadRequestException({ message: 'تعذر الاعتماد بسبب فشل التحقق من بنية طلب Oracle', issues: check.issues });
    const oracleDraft = this.oracleWriter.isEnabled()
      ? await this.oracleWriter.createDraft({
        externalReference: `inventory-transfer:${row.id}`,
        sourceWarehouseCode: row.sourceWarehouseCode,
        destinationWarehouseCode: row.destinationWarehouseCode,
        requestSide: 'منصة البناء الراقي',
        notes: (row.notes || 'طلب تحويل معتمد من منصة البناء الراقي').slice(0, 250),
        lines: row.lines.map((line) => ({
          itemCode: line.itemCode,
          unitCode: line.unitCode,
          quantity: Number(line.quantity),
        })),
      })
      : null;
    const updated = await this.prisma.inventoryTransferRequest.update({
      where: { id }, data: {
        status: 'approved', reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: dto.note?.trim() || null,
        ...(oracleDraft ? { oracleOutReqNo: oracleDraft.requestNo, oracleOutReqSer: oracleDraft.requestSerial } : {}),
      }, include: this.include,
    });
    await this.audit.log({
      userId: actor.id,
      action: oracleDraft ? 'inventory_transfer_approved_oracle_draft_created' : 'inventory_transfer_approved_dry_run',
      entityTable: 'inventory_transfer_requests',
      entityId: id,
      newValue: {
        oracleWriteAttempted: Boolean(oracleDraft),
        oracleDraftCreated: oracleDraft?.created ?? false,
        oracleOutReqNo: oracleDraft?.requestNo ?? null,
        oracleOutReqSer: oracleDraft?.requestSerial ?? null,
        oracleWriteSchema: oracleDraft ? this.oracleWriter.targetSchema() : null,
      },
      req,
    });
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

  async linkOracleDocument(actor: AuthUser, id: string, dto: LinkOracleTransferDocumentDto, req: Request) {
    const row = await this.scoped(actor, id);
    if (row.status !== 'approved') {
      throw new ConflictException('لا يمكن ربط مستند Oracle قبل اعتماد الطلب');
    }
    const sourceTransferSerial = dto.sourceTransferSerial.trim();
    if (row.oracleSourceTransferSerial && row.oracleSourceTransferSerial !== sourceTransferSerial) {
      throw new ConflictException('الطلب مرتبط مسبقًا بمستند Oracle آخر');
    }
    if (row.oracleSourceTransferSerial === sourceTransferSerial) {
      return this.refreshOracleStatus(actor, id, req);
    }
    const status = await this.oracle.transferStatus({
      sourceTransferSerial,
      sourceWarehouseCode: row.sourceWarehouseCode,
      destinationWarehouseCode: row.destinationWarehouseCode,
      itemCodes: row.lines.map((line) => line.itemCode),
    });
    if (!status?.sourceTransferSerial) {
      throw new BadRequestException('لم يُعثر على مستند Oracle مطابق للمصدر والوجهة والأصناف المحددة');
    }
    if (status.sourceTransferSerial !== sourceTransferSerial) {
      throw new ConflictException('مستند Oracle المعاد لا يطابق رقم TR_SER المطلوب');
    }
    if (status.destinationReceived && !status.sourceIssued) {
      throw new ConflictException('Oracle أعاد طرف وجهة بلا طرف مصدر مرتبط');
    }
    if (status.transferCompleted !== (status.sourceIssued && status.destinationReceived)) {
      throw new ConflictException('حالة اكتمال التحويل لا تطابق وجود طرفي المصدر والوجهة');
    }
    const updated = await this.prisma.inventoryTransferRequest.update({
      where: { id }, data: {
        oracleOutReqSer: status.outReqSer ?? row.oracleOutReqSer,
        oracleTransferDocumentNumber: status.transferDocumentNumber,
        oracleSourceTransferSerial: status.sourceTransferSerial,
        oracleDestinationTransferSerial: status.destinationTransferSerial,
        sourceIssued: status.sourceIssued,
        destinationReceived: status.destinationReceived,
        transferCompleted: status.transferCompleted,
        lastOracleCheckedAt: new Date(),
      }, include: this.include,
    });
    await this.audit.log({
      userId: actor.id,
      action: 'inventory_transfer_oracle_document_linked',
      entityTable: 'inventory_transfer_requests',
      entityId: id,
      newValue: {
        sourceTransferSerial: status.sourceTransferSerial,
        sourceIssued: status.sourceIssued,
        destinationReceived: status.destinationReceived,
        transferCompleted: status.transferCompleted,
        oracleWriteAttempted: false,
      },
      req,
    });
    return { found: true, request: updated };
  }

  async refreshOracleStatus(actor: AuthUser, id: string, req: Request) {
    const row = await this.scoped(actor, id);
    let sourceTransferSerial = row.oracleSourceTransferSerial;
    if (!sourceTransferSerial) {
      if (!row.oracleOutReqSer) {
        throw new BadRequestException('رقم OUT_REQ_SER مطلوب لاكتشاف مستند Oracle تلقائيًا');
      }
      const documents = await this.oracle.transferDocumentsByOutRequest(row.oracleOutReqSer);
      const matching = documents.filter((document) => document.warehouseCode === row.sourceWarehouseCode
        && document.destinationWarehouseCode === row.destinationWarehouseCode);
      if (matching.length > 1) {
        throw new ConflictException('عُثر على أكثر من مستند مصدر مطابق لطلب Oracle؛ يلزم فحص مسؤول النظام');
      }
      sourceTransferSerial = matching[0]?.transferSerial ?? null;
      if (!sourceTransferSerial) {
        const updated = await this.prisma.inventoryTransferRequest.update({
          where: { id }, data: {
            oracleTransferDocumentNumber: null,
            oracleDestinationTransferSerial: null,
            sourceIssued: false,
            destinationReceived: false,
            transferCompleted: false,
            lastOracleCheckedAt: new Date(),
          }, include: this.include,
        });
        await this.audit.log({
          userId: actor.id,
          action: 'inventory_transfer_oracle_document_not_issued',
          entityTable: 'inventory_transfer_requests',
          entityId: id,
          newValue: { outReqSer: row.oracleOutReqSer, oracleWriteAttempted: false },
          req,
        });
        return { found: false, request: updated };
      }
    }
    const status = await this.oracle.transferStatus({
      sourceTransferSerial,
      sourceWarehouseCode: row.sourceWarehouseCode,
      destinationWarehouseCode: row.destinationWarehouseCode,
      itemCodes: row.lines.map((line) => line.itemCode),
    });
    if (!status) {
      const updated = await this.prisma.inventoryTransferRequest.update({
        where: { id }, data: {
          oracleTransferDocumentNumber: null,
          oracleDestinationTransferSerial: null,
          sourceIssued: false,
          destinationReceived: false,
          transferCompleted: false,
          lastOracleCheckedAt: new Date(),
        }, include: this.include,
      });
      await this.audit.log({
        userId: actor.id,
        action: 'inventory_transfer_oracle_status_missing',
        entityTable: 'inventory_transfer_requests',
        entityId: id,
        newValue: {
          sourceTransferSerial,
          sourceIssued: false,
          destinationReceived: false,
          transferCompleted: false,
          oracleWriteAttempted: false,
        },
        req,
      });
      return { found: false, request: updated };
    }
    if (status.destinationReceived && !status.sourceIssued) throw new ConflictException('Oracle أعاد طرف وجهة بلا طرف مصدر مرتبط');
    if (status.transferCompleted !== (status.sourceIssued && status.destinationReceived)) {
      throw new ConflictException('حالة اكتمال التحويل لا تطابق وجود طرفي المصدر والوجهة');
    }
    const updated = await this.prisma.inventoryTransferRequest.update({
      where: { id }, data: {
        oracleOutReqSer: status.outReqSer ?? row.oracleOutReqSer, oracleTransferDocumentNumber: status.transferDocumentNumber,
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
