import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OracleInventoryPublicationService } from '../oracle-inventory-sync/oracle-inventory-publication.service';
import { OracleMovementAutoPublicationService } from '../oracle-movement-sync/oracle-movement-auto-publication.service';
import { OracleExceptionDecision } from './dto/review-oracle-exception.dto';

type ExceptionRow = {
  id: string; movement_kind: 'customer' | 'inventory'; source_schema: string;
  source_run_id: string; source_fingerprint: string; status: string; reason_code: string;
  business_key: string | null; details: Record<string, unknown> | null;
  first_seen_at: Date; last_seen_at: Date;
  review_id: string | null; decision: OracleExceptionDecision | null; review_status: string | null;
  notes: string | null; reviewed_at: Date | null; reviewer_name: string | null;
};

type CustomerSourceRow = {
  id: string; source_fingerprint: string; customer_id: string; platform_currency: string;
  document_type_id: string; document_date: Date; document_number: string | null;
  description: string | null; reference_number: string | null;
  platform_debit: Prisma.Decimal; platform_credit: Prisma.Decimal;
  external_customer_code: string; document_type: string;
};

const LOCK_KEY = 3_941_620_027;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class OracleExceptionReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryPublication: OracleInventoryPublicationService,
    private readonly movementPublication: OracleMovementAutoPublicationService,
  ) {}

  async list(organizationId: string, filters: { review?: string; kind?: string; reason?: string }) {
    const review = ['reviewed', 'all'].includes(filters.review ?? '') ? filters.review! : 'unreviewed';
    const kind = ['customer', 'inventory'].includes(filters.kind ?? '') ? filters.kind! : null;
    const reason = filters.reason?.trim() || null;
    const rows = await this.prisma.$queryRaw<ExceptionRow[]>(Prisma.sql`
      SELECT l.id,l.movement_kind,l.source_schema,l.source_run_id,l.source_fingerprint,l.status,
             COALESCE(r.review_details->>'originalReasonCode',l.reason_code) AS reason_code,
             l.business_key,l.details,l.first_seen_at,l.last_seen_at,
             r.id AS review_id,r.decision,r.status AS review_status,r.notes,r.reviewed_at,
             u.full_name AS reviewer_name
      FROM oracle_movement_publication_ledger l
      LEFT JOIN oracle_movement_exception_reviews r ON r.ledger_id=l.id
      LEFT JOIN users u ON u.id=r.reviewed_by
      WHERE l.organization_id=${organizationId}::uuid
        AND (l.status='quarantined' OR r.id IS NOT NULL)
        AND (${kind}::text IS NULL OR l.movement_kind=${kind})
        AND (${reason}::text IS NULL OR l.reason_code=${reason})
        AND (${review}='all' OR (${review}='reviewed' AND r.id IS NOT NULL) OR (${review}='unreviewed' AND r.id IS NULL))
      ORDER BY CASE WHEN r.id IS NULL THEN 0 ELSE 1 END,l.last_seen_at DESC
    `);
    const counts = await this.prisma.$queryRaw<Array<{ total: bigint; unreviewed: bigint; reviewed: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS total,COUNT(*) FILTER (WHERE r.id IS NULL) AS unreviewed,
             COUNT(*) FILTER (WHERE r.id IS NOT NULL) AS reviewed
      FROM oracle_movement_publication_ledger l
      LEFT JOIN oracle_movement_exception_reviews r ON r.ledger_id=l.id
      WHERE l.organization_id=${organizationId}::uuid AND (l.status='quarantined' OR r.id IS NOT NULL)
    `);
    return {
      mode: 'platform_review_only', oracleWriteEnabled: false,
      counts: { total: Number(counts[0]?.total ?? 0), unreviewed: Number(counts[0]?.unreviewed ?? 0), reviewed: Number(counts[0]?.reviewed ?? 0) },
      items: rows.map((row) => ({
        id: row.id, kind: row.movement_kind, sourceSchema: row.source_schema,
        sourceRunId: row.source_run_id, fingerprint: row.source_fingerprint, status: row.status,
        reasonCode: row.reason_code, businessKey: row.business_key, details: row.details,
        firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,
        review: row.review_id ? { id: row.review_id, decision: row.decision, status: row.review_status,
          notes: row.notes, reviewedAt: row.reviewed_at, reviewerName: row.reviewer_name } : null,
      })),
    };
  }

  private async ledger(organizationId: string, ledgerId: string) {
    const rows = await this.prisma.$queryRaw<ExceptionRow[]>(Prisma.sql`
      SELECT l.id,l.movement_kind,l.source_schema,l.source_run_id,l.source_fingerprint,l.status,
             l.reason_code,l.business_key,l.details,l.first_seen_at,l.last_seen_at,
             NULL::uuid review_id,NULL::varchar decision,NULL::varchar review_status,NULL::text notes,
             NULL::timestamptz reviewed_at,NULL::text reviewer_name
      FROM oracle_movement_publication_ledger l
      WHERE l.id=${ledgerId}::uuid AND l.organization_id=${organizationId}::uuid
    `);
    if (!rows[0]) throw new NotFoundException('الاستثناء غير موجود.');
    if (rows[0].status !== 'quarantined') throw new BadRequestException('هذا السجل لم يعد بانتظار المراجعة.');
    return rows[0];
  }

  private ensureDecision(row: ExceptionRow, decision: OracleExceptionDecision) {
    if (row.reason_code === 'historical_sales_return_pending_review') {
      throw new BadRequestException('مردود المبيعات التاريخي يبقى معلقًا للمراجعة ولا يجوز استبعاده حاليًا.');
    }
    const externalCustomerCode = String(row.details?.externalCustomerCode ?? '');
    const documentNumber = String(row.details?.documentNumber ?? '');
    const targetedDecision = externalCustomerCode === '30667' && documentNumber === '3394'
      ? 'publish_verified_historical_collection'
      : externalCustomerCode === '20563' && documentNumber === '4875'
        ? 'reassign_historical_invoice'
        : externalCustomerCode === '20561' && documentNumber === '4789'
          ? 'adopt_oracle_amount'
        : null;
    const allowed = row.reason_code === 'before_publication_cutoff'
      ? (targetedDecision ? [targetedDecision] : ['keep_excluded'])
      : row.reason_code === 'amount_conflict_same_business_key'
        ? ['keep_excluded', 'adopt_oracle_amount']
        : row.reason_code === 'unknown_item_in_active_snapshot'
          ? ['keep_excluded', 'publish_inventory_snapshot_and_retry']
          : ['keep_excluded'];
    if (!allowed.includes(decision)) throw new BadRequestException('القرار غير مسموح لهذا النوع من الاستثناءات.');
  }

  private async customerSource(row: ExceptionRow, organizationId: string, db: Prisma.TransactionClient | PrismaService) {
    const source = await db.$queryRaw<CustomerSourceRow[]>(Prisma.sql`
      SELECT m.id,m.source_fingerprint,c.id customer_id,
        CASE m.currency_code WHEN 'YR' THEN 'YER' WHEN 'YER' THEN 'YER' WHEN 'SR' THEN 'SAR' WHEN 'SAR' THEN 'SAR' WHEN '$' THEN 'USD' WHEN 'USD' THEN 'USD' END platform_currency,
        dt.id document_type_id,m.document_date,m.document_number,m.description,m.reference_number,
        CASE WHEN m.currency_code IN ('YR','YER','$','USD') THEN m.debit_foreign ELSE m.debit_local END platform_debit,
        CASE WHEN m.currency_code IN ('YR','YER','$','USD') THEN m.credit_foreign ELSE m.credit_local END platform_credit,
        m.external_customer_code,m.document_type
      FROM oracle_customer_movements_mirror m
      JOIN customers c ON c.organization_id=m.organization_id AND c.external_customer_code=m.external_customer_code
      JOIN document_types dt ON dt.organization_id=m.organization_id AND dt.active AND dt.name=CASE
        WHEN m.document_type='1' THEN 'قيد يومية' WHEN m.document_type='2' AND COALESCE(m.document_jv_type,'1')='2' THEN 'سند قبض بنكي'
        WHEN m.document_type='2' THEN 'سند قبض نقدي' WHEN m.document_type='3' AND COALESCE(m.document_jv_type,'1')='2' THEN 'سند صرف بنكي'
        WHEN m.document_type='3' THEN 'سند صرف نقدي' WHEN m.document_type='4' THEN 'فاتورة المبيعات آجل'
        WHEN m.document_type='5' THEN 'فاتورة مردود المبيعات آجل' WHEN m.document_type='6' THEN 'فاتورة المشتريات آجل'
        WHEN m.document_type='8' THEN 'أمر توريد مخزني' END
      WHERE m.sync_run_id=${row.source_run_id}::uuid AND m.organization_id=${organizationId}::uuid
        AND m.source_fingerprint=${row.source_fingerprint}
    `);
    if (!source[0]) throw new BadRequestException('تعذر تحديد حركة Oracle المطابقة.');
    return source[0];
  }

  private async recalculateBalance(tx: Prisma.TransactionClient, customerId: string, currencyCode: string, importJobId: string) {
    const balance = await tx.customerBalance.findUnique({ where:{ customerId_currencyCode:{ customerId,currencyCode } } });
    const totals = await tx.importedTransaction.aggregate({ where:{ customerId,currencyCode,reversedAt:null }, _sum:{ debit:true,credit:true } });
    const accounting = (balance?.openingDebit ?? new Prisma.Decimal(0)).minus(balance?.openingCredit ?? 0)
      .plus(totals._sum.debit ?? 0).minus(totals._sum.credit ?? 0);
    await tx.customerBalance.upsert({ where:{ customerId_currencyCode:{ customerId,currencyCode } },
      create:{ customerId,currencyCode,accountingBalance:accounting,lastImportJobId:importJobId },
      update:{ accountingBalance:accounting,lastImportJobId:importJobId,updatedAt:new Date() } });
    return accounting;
  }

  private async applyTargetedCustomerDecision(row: ExceptionRow, organizationId: string, reviewedBy: string,
    notes: string, decision: 'publish_verified_historical_collection' | 'reassign_historical_invoice') {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
      const source = await this.customerSource(row,organizationId,tx);
      const expected = decision === 'publish_verified_historical_collection'
        ? source.external_customer_code === '30667' && source.document_number === '3394' && source.platform_debit.isZero() && source.platform_credit.equals(575)
        : source.external_customer_code === '20563' && source.document_number === '4875' && source.platform_debit.equals(760000) && source.platform_credit.isZero();
      if (!expected) throw new BadRequestException('تغيرت بيانات الحركة عن الحالة التي تمت الموافقة عليها؛ أعد المراجعة قبل التنفيذ.');

      const sameBusinessRows = await tx.importedTransaction.findMany({ where:{
        currencyCode:source.platform_currency,txDate:source.document_date,documentTypeId:source.document_type_id,
        documentNumber:source.document_number,reversedAt:null,customer:{ organizationId },
      }, select:{ id:true,customerId:true,debit:true,credit:true } });
      if (decision === 'publish_verified_historical_collection' && sameBusinessRows.length) {
        throw new BadRequestException('الحركة موجودة بالفعل في المنصة؛ أوقف التنفيذ وراجع التكرار.');
      }
      if (decision === 'reassign_historical_invoice' &&
          (sameBusinessRows.length !== 1 || sameBusinessRows[0].customerId === source.customer_id ||
           !sameBusinessRows[0].debit.equals(source.platform_debit) || !sameBusinessRows[0].credit.equals(source.platform_credit))) {
        throw new BadRequestException('لم تعد الفاتورة الحالية مطابقة لشروط تصحيح الإسناد الآمن.');
      }

      const job = await tx.importJob.create({ data:{ organizationId,
        fileName:`oracle-targeted-review-${row.id}.json`,fileHash:sha256(`oracle-targeted-review:${row.id}:${Date.now()}`),
        uploadedBy:reviewedBy,status:'completed',rowsTotal:1,txnsInFile:1,customersNew:0,
        customersUpdated:decision === 'reassign_historical_invoice' ? 2 : 1,txnsInserted:1,txnsSkippedDuplicate:0,errorsCount:0,
      } });
      let previousCustomerId: string | null = null;
      if (decision === 'reassign_historical_invoice') {
        previousCustomerId = sameBusinessRows[0].customerId;
        await tx.importedTransaction.update({ where:{ id:sameBusinessRows[0].id },data:{ reversedAt:new Date() } });
      }
      const created = await tx.importedTransaction.create({ data:{
        customerId:source.customer_id,currencyCode:source.platform_currency,documentTypeId:source.document_type_id,
        txDate:source.document_date,documentNumber:source.document_number,description:source.description,
        referenceNumber:source.reference_number,debit:source.platform_debit.toDecimalPlaces(4),credit:source.platform_credit.toDecimalPlaces(4),
        lineHash:sha256(`oracle-targeted-approved:${source.source_fingerprint}`),importJobId:job.id,
      } });
      const sourceBalance = await this.recalculateBalance(tx,source.customer_id,source.platform_currency,job.id);
      let previousBalance: Prisma.Decimal | null = null;
      if (previousCustomerId) previousBalance = await this.recalculateBalance(tx,previousCustomerId,source.platform_currency,job.id);
      const batch = await tx.oracleMovementPublicationBatch.create({ data:{ organizationId,sourceSchema:row.source_schema,
        sourceRunId:row.source_run_id,mode:'manual',status:'completed',triggeredBy:reviewedBy,completedAt:new Date(),
        counts:{ decision,publishedRows:1,reversedRows:previousCustomerId ? 1 : 0 } } });
      await tx.oracleMovementPublicationLedger.update({ where:{ id:row.id },data:{ status:'published',
        reasonCode:decision === 'reassign_historical_invoice' ? 'approved_customer_reassignment' : 'approved_verified_historical_collection',
        publicationBatchId:batch.id,platformEntityId:created.id,publishedAt:new Date(),lastSeenAt:new Date() } });
      const reviewDetails = { originalReasonCode:row.reason_code,decision,importJobId:job.id,batchId:batch.id,
        createdTransactionId:created.id,reversedTransactionId:decision === 'reassign_historical_invoice' ? sameBusinessRows[0].id : null,
        sourceCustomerCode:source.external_customer_code,sourceBalance:sourceBalance.toString(),previousCustomerId,
        previousBalance:previousBalance?.toString() ?? null,oracleUnchanged:true };
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO oracle_movement_exception_reviews(organization_id,ledger_id,decision,status,reviewed_by,notes,review_details)
        VALUES(${organizationId}::uuid,${row.id}::uuid,${decision},'applied',${reviewedBy}::uuid,${notes},${JSON.stringify(reviewDetails)}::jsonb)
        ON CONFLICT(ledger_id) DO UPDATE SET decision=EXCLUDED.decision,status='applied',reviewed_by=EXCLUDED.reviewed_by,
          notes=EXCLUDED.notes,review_details=EXCLUDED.review_details,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      `);
      await tx.auditLog.create({ data:{ userId:reviewedBy,
        action:decision === 'reassign_historical_invoice' ? 'oracle_exception_invoice_reassigned' : 'oracle_exception_historical_collection_published',
        entityTable:'oracle_movement_exception_reviews',entityId:row.id,newValue:reviewDetails as Prisma.InputJsonValue,
        reason:`${notes} | Targeted platform-only decision; Oracle remained read-only.` } });
      return reviewDetails;
    },{ maxWait:20_000,timeout:120_000 });
  }

  private async saveReview(options: { organizationId: string; ledgerId: string; decision: OracleExceptionDecision;
    status: 'recorded' | 'applied' | 'failed'; reviewedBy: string; notes: string; details?: unknown }) {
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO oracle_movement_exception_reviews(
        organization_id,ledger_id,decision,status,reviewed_by,notes,review_details,reviewed_at,updated_at
      ) VALUES(
        ${options.organizationId}::uuid,${options.ledgerId}::uuid,${options.decision},${options.status},
        ${options.reviewedBy}::uuid,${options.notes},${JSON.stringify(options.details ?? {})}::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
      ) ON CONFLICT(ledger_id) DO UPDATE SET decision=EXCLUDED.decision,status=EXCLUDED.status,
        reviewed_by=EXCLUDED.reviewed_by,notes=EXCLUDED.notes,review_details=EXCLUDED.review_details,
        reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    `);
  }

  private async adoptOracleAmount(row: ExceptionRow, organizationId: string, reviewedBy: string, notes: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
      const source = await tx.$queryRaw<CustomerSourceRow[]>(Prisma.sql`
        WITH mapped AS (
          SELECT m.id,m.source_fingerprint,c.id customer_id,
            CASE m.currency_code WHEN 'YR' THEN 'YER' WHEN 'YER' THEN 'YER' WHEN 'SR' THEN 'SAR' WHEN 'SAR' THEN 'SAR' WHEN '$' THEN 'USD' WHEN 'USD' THEN 'USD' END platform_currency,
            dt.id document_type_id,m.document_date,m.document_number,m.description,m.reference_number,
            CASE WHEN m.currency_code IN ('YR','YER','$','USD') THEN m.debit_foreign ELSE m.debit_local END platform_debit,
            CASE WHEN m.currency_code IN ('YR','YER','$','USD') THEN m.credit_foreign ELSE m.credit_local END platform_credit,
            m.external_customer_code,m.document_type,m.document_jv_type
          FROM oracle_customer_movements_mirror m
          JOIN customers c ON c.organization_id=m.organization_id AND c.external_customer_code=m.external_customer_code
          JOIN document_types dt ON dt.organization_id=m.organization_id AND dt.active AND dt.name=CASE
            WHEN m.document_type='1' THEN 'قيد يومية' WHEN m.document_type='2' AND COALESCE(m.document_jv_type,'1')='2' THEN 'سند قبض بنكي'
            WHEN m.document_type='2' THEN 'سند قبض نقدي' WHEN m.document_type='3' AND COALESCE(m.document_jv_type,'1')='2' THEN 'سند صرف بنكي'
            WHEN m.document_type='3' THEN 'سند صرف نقدي' WHEN m.document_type='4' THEN 'فاتورة المبيعات آجل'
            WHEN m.document_type='5' THEN 'فاتورة مردود المبيعات آجل' WHEN m.document_type='6' THEN 'فاتورة المشتريات آجل'
            WHEN m.document_type='8' THEN 'أمر توريد مخزني' END
          WHERE m.sync_run_id=${row.source_run_id}::uuid AND m.organization_id=${organizationId}::uuid
        ), target AS (SELECT * FROM mapped WHERE source_fingerprint=${row.source_fingerprint})
        SELECT m.id,m.source_fingerprint,m.customer_id,m.platform_currency,m.document_type_id,m.document_date,
               m.document_number,m.description,m.reference_number,m.platform_debit,m.platform_credit
        FROM mapped m CROSS JOIN target t
        WHERE m.customer_id=t.customer_id AND m.platform_currency=t.platform_currency
          AND m.document_date=t.document_date AND m.document_type_id=t.document_type_id
          AND COALESCE(m.document_number,'')=COALESCE(t.document_number,'')
        ORDER BY m.source_fingerprint
      `);
      if (!source.length) throw new BadRequestException('تعذر تحديد مجموعة حركة Oracle المطابقة.');
      const key = source[0];
      const existing = await tx.importedTransaction.findMany({ where: {
        customerId: key.customer_id, currencyCode: key.platform_currency, txDate: key.document_date,
        documentTypeId: key.document_type_id, documentNumber: key.document_number, reversedAt: null,
      }, select: { id: true } });
      if (!existing.length) throw new BadRequestException('لم تعد الحركة القديمة الفعالة موجودة للمقارنة.');
      const job = await tx.importJob.create({ data: {
        organizationId,fileName:`oracle-exception-${row.id}.json`,fileHash:sha256(`oracle-exception:${row.id}:${Date.now()}`),
        uploadedBy:reviewedBy,status:'completed',rowsTotal:source.length,txnsInFile:source.length,
        customersNew:0,customersUpdated:1,txnsInserted:source.length,txnsSkippedDuplicate:0,errorsCount:0,
      } });
      await tx.importedTransaction.updateMany({ where: { id: { in: existing.map((item) => item.id) } }, data: { reversedAt: new Date() } });
      const created: Array<{ id: string }> = [];
      for (const item of source) created.push(await tx.importedTransaction.create({ data: {
        customerId:item.customer_id,currencyCode:item.platform_currency,documentTypeId:item.document_type_id,
        txDate:item.document_date,documentNumber:item.document_number,description:item.description,referenceNumber:item.reference_number,
        debit:item.platform_debit.toDecimalPlaces(4),credit:item.platform_credit.toDecimalPlaces(4),
        lineHash:sha256(`oracle-exception-approved:${item.source_fingerprint}`),importJobId:job.id,
      } }));
      const balance = await tx.customerBalance.findUnique({ where: { customerId_currencyCode: { customerId:key.customer_id,currencyCode:key.platform_currency } } });
      const totals = await tx.importedTransaction.aggregate({ where: { customerId:key.customer_id,currencyCode:key.platform_currency,reversedAt:null }, _sum:{ debit:true,credit:true } });
      const accounting = (balance?.openingDebit ?? new Prisma.Decimal(0)).minus(balance?.openingCredit ?? 0)
        .plus(totals._sum.debit ?? 0).minus(totals._sum.credit ?? 0);
      await tx.customerBalance.upsert({ where: { customerId_currencyCode: { customerId:key.customer_id,currencyCode:key.platform_currency } },
        create:{ customerId:key.customer_id,currencyCode:key.platform_currency,accountingBalance:accounting,lastImportJobId:job.id },
        update:{ accountingBalance:accounting,lastImportJobId:job.id,updatedAt:new Date() } });
      const batch = await tx.oracleMovementPublicationBatch.create({ data: {
        organizationId,sourceSchema:row.source_schema,sourceRunId:row.source_run_id,mode:'manual',status:'completed',
        triggeredBy:reviewedBy,completedAt:new Date(),counts:{ approvedCustomerRows:source.length,reversedPlatformRows:existing.length },
      } });
      for (let index=0; index<source.length; index++) await tx.$executeRaw(Prisma.sql`
        UPDATE oracle_movement_publication_ledger SET status='published',reason_code='approved_oracle_amount',
          publication_batch_id=${batch.id}::uuid,platform_entity_id=${created[index].id}::uuid,published_at=CURRENT_TIMESTAMP,last_seen_at=CURRENT_TIMESTAMP
        WHERE organization_id=${organizationId}::uuid AND source_schema=${row.source_schema} AND movement_kind='customer'
          AND source_fingerprint=${source[index].source_fingerprint}
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO oracle_movement_exception_reviews(organization_id,ledger_id,decision,status,reviewed_by,notes,review_details)
        VALUES(${organizationId}::uuid,${row.id}::uuid,'adopt_oracle_amount','applied',${reviewedBy}::uuid,${notes},
          ${JSON.stringify({ originalReasonCode:row.reason_code,importJobId:job.id,batchId:batch.id,reversedPlatformRows:existing.length,oracleRows:source.length })}::jsonb)
        ON CONFLICT(ledger_id) DO UPDATE SET decision=EXCLUDED.decision,status='applied',reviewed_by=EXCLUDED.reviewed_by,
          notes=EXCLUDED.notes,review_details=EXCLUDED.review_details,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      `);
      await tx.auditLog.create({ data:{ userId:reviewedBy,action:'oracle_exception_amount_approved',entityTable:'oracle_movement_exception_reviews',
        entityId:row.id,newValue:{ importJobId:job.id,batchId:batch.id,oracleRows:source.length,reversedPlatformRows:existing.length },
        reason:`${notes} | Oracle remained read-only; platform rows were non-destructively reversed.` } });
      return { importJobId:job.id,batchId:batch.id,oracleRows:source.length,reversedPlatformRows:existing.length };
    }, { maxWait:20_000,timeout:120_000 });
    return result;
  }

  async review(organizationId: string, ledgerId: string, reviewedBy: string, decision: OracleExceptionDecision, notes: string) {
    const row = await this.ledger(organizationId, ledgerId);
    this.ensureDecision(row, decision);
    if (decision === 'keep_excluded') {
      await this.saveReview({ organizationId,ledgerId,decision,status:'recorded',reviewedBy,notes,
        details:{ originalReasonCode:row.reason_code,oracleUnchanged:true,platformUnchanged:true } });
      await this.prisma.auditLog.create({ data:{ userId:reviewedBy,action:'oracle_exception_kept_excluded',
        entityTable:'oracle_movement_exception_reviews',entityId:ledgerId,newValue:{ decision,reasonCode:row.reason_code },reason:notes } });
      return { applied:true,status:'recorded',decision,oracleWriteEnabled:false };
    }
    if (decision === 'adopt_oracle_amount') {
      const result = await this.adoptOracleAmount(row,organizationId,reviewedBy,notes);
      return { applied:true,status:'applied',decision,result,oracleWriteEnabled:false };
    }
    if (decision === 'publish_verified_historical_collection' || decision === 'reassign_historical_invoice') {
      const result = await this.applyTargetedCustomerDecision(row,organizationId,reviewedBy,notes,decision);
      return { applied:true,status:'applied',decision,result,oracleWriteEnabled:false };
    }
    const latest = await this.prisma.oracleInventorySyncRun.findFirst({ where:{ organizationId,sourceSchema:row.source_schema,status:'validating' }, orderBy:{ startedAt:'desc' }, select:{ id:true } });
    if (!latest) throw new BadRequestException('لا توجد لقطة مخزون حديثة بحالة المراجعة.');
    const snapshot = await this.inventoryPublication.publish(latest.id);
    if (!snapshot.published) throw new BadRequestException('فشل اعتماد لقطة المخزون؛ راجع أخطاء التحقق.');
    const publication = await this.movementPublication.publish({ organizationId,sourceSchema:row.source_schema,publishedBy:reviewedBy,apply:true });
    await this.saveReview({ organizationId,ledgerId,decision,status:'applied',reviewedBy,notes,
      details:{ originalReasonCode:row.reason_code,snapshot,publication,oracleUnchanged:true } });
    await this.prisma.auditLog.create({ data:{ userId:reviewedBy,action:'oracle_exception_inventory_snapshot_approved',
      entityTable:'oracle_movement_exception_reviews',entityId:ledgerId,
      newValue:JSON.parse(JSON.stringify({ runId:latest.id,publication })) as Prisma.InputJsonValue,reason:notes } });
    return { applied:true,status:'applied',decision,snapshot,publication,oracleWriteEnabled:false };
  }
}
