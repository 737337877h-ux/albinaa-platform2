import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const SETTING_KEY = 'oracleMovementAutoPublish';
const LOCK_KEY = 3_941_620_026;

type PublicationConfig = {
  enabled: boolean;
  baselineRunId: string;
  minimumMovementDate: string;
  customer: boolean;
  inventory: boolean;
  updatedAt: string;
};

type CustomerCandidate = {
  id: string;
  source_fingerprint: string;
  source_hash: string;
  external_customer_code: string;
  currency_code: string;
  document_date: Date;
  document_type: string;
  document_jv_type: string | null;
  document_number: string | null;
  description: string | null;
  reference_number: string | null;
  customer_id: string | null;
  customer_status: string | null;
  platform_currency: string | null;
  platform_debit: Prisma.Decimal;
  platform_credit: Prisma.Decimal;
  document_type_id: string | null;
  currency_exists: boolean;
  source_group_debit: Prisma.Decimal | null;
  source_group_credit: Prisma.Decimal | null;
  platform_rows: bigint;
  platform_group_debit: Prisma.Decimal;
  platform_group_credit: Prisma.Decimal;
};

type InventoryCandidate = {
  id: string;
  source_fingerprint: string;
  source_hash: string;
  movement_date: Date;
  document_type: string;
  document_number: string;
  document_sequence: string;
  serial_number: string;
  external_item_code: string;
  unit_name: string;
  package_size: Prisma.Decimal;
  item_quantity: Prisma.Decimal;
  free_quantity: Prisma.Decimal;
  primary_quantity: Prisma.Decimal;
  primary_free_quantity: Prisma.Decimal;
  in_out: number;
  external_warehouse_code: string;
  external_warehouse_group_code: string | null;
  description: string | null;
  reference_number: string | null;
  barcode: string | null;
  external_customer_code: string | null;
  item_exists: boolean;
  unit_exists: boolean;
  warehouse_exists: boolean;
  existing_business_rows: bigint;
  existing_package_size: Prisma.Decimal | null;
  existing_item_quantity: Prisma.Decimal | null;
  existing_free_quantity: Prisma.Decimal | null;
  existing_primary_quantity: Prisma.Decimal | null;
  existing_primary_free_quantity: Prisma.Decimal | null;
  existing_in_out: number | null;
  existing_warehouse_group_code: string | null;
  existing_description: string | null;
  existing_reference_number: string | null;
  existing_barcode: string | null;
};

type Classified<T> = {
  row: T;
  action: 'publish' | 'ignore' | 'quarantine';
  reasonCode: string;
  businessKey: string;
  details: Record<string, unknown>;
};

type QueryClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function decimal4(value: Prisma.Decimal) {
  return value.toDecimalPlaces(4);
}

function sameAmount(left: Prisma.Decimal | null, right: Prisma.Decimal) {
  return left !== null && decimal4(left).equals(decimal4(right));
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeCustomerName(value: string) {
  return value.normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

@Injectable()
export class OracleMovementAutoPublicationService {
  constructor(private readonly prisma: PrismaService) {}

  private async latestRun(organizationId: string, sourceSchema: string) {
    const run = await this.prisma.oracleMovementSyncRun.findFirst({
      where: { organizationId, sourceSchema, status: 'validating' },
      orderBy: { startedAt: 'desc' },
      select: { id: true, sourceSchema: true, startedAt: true, sourceCounts: true },
    });
    if (!run) throw new Error('No validating Oracle movement mirror run is available.');
    return run;
  }

  private async readConfig(organizationId: string): Promise<PublicationConfig | null> {
    const rows = await this.prisma.$queryRaw<Array<{ value: PublicationConfig }>>(Prisma.sql`
      SELECT value
      FROM system_settings
      WHERE organization_id = ${organizationId}::uuid AND key = ${SETTING_KEY}
      LIMIT 1
    `);
    return rows[0]?.value ?? null;
  }

  private async ensureNewCustomersFromLatestMirror(tx: Prisma.TransactionClient, organizationId: string) {
    const latest = await tx.oracleCustomerSyncRun.findFirst({
      where: { organizationId, status: 'validating' },
      orderBy: [{ extractedAt: 'desc' }, { startedAt: 'desc' }],
      select: { id: true },
    });
    if (!latest) return 0;
    const mirrored = await tx.oracleCustomerMirror.findMany({
      where: { syncRunId: latest.id, organizationId },
      select: {
        externalCustomerCode: true, accountNumber: true, nameAr: true, phone: true, mobile: true,
        address: true, relationshipStartDate: true, isInactive: true,
      },
    });
    const existing = await tx.customer.findMany({
      where: { organizationId, externalCustomerCode: { in: mirrored.map((row) => row.externalCustomerCode) } },
      select: { externalCustomerCode: true },
    });
    const existingCodes = new Set(existing.map((row) => row.externalCustomerCode));
    const missing = mirrored.filter((row) => !existingCodes.has(row.externalCustomerCode));
    if (!missing.length) return 0;
    const result = await tx.customer.createMany({
      data: missing.map((row) => ({
        organizationId,
        externalCustomerCode: row.externalCustomerCode,
        accountNumber: row.accountNumber,
        name: row.nameAr.trim() || row.externalCustomerCode,
        nameNormalized: normalizeCustomerName(row.nameAr || row.externalCustomerCode),
        phonePrimary: row.mobile || row.phone,
        phoneSecondary: row.mobile && row.phone && row.mobile !== row.phone ? row.phone : null,
        address: row.address,
        relationshipStartDate: row.relationshipStartDate,
        status: row.isInactive ? 'inactive' : 'active',
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  private async reconcileCurrentCustomerBalances(
    tx: Prisma.TransactionClient,
    organizationId: string,
    publishedBy: string,
  ) {
    const differences = await tx.$queryRaw<Array<{
      customer_id: string;
      external_customer_code: string;
      currency_code: string;
      oracle_amount: Prisma.Decimal;
      platform_amount: Prisma.Decimal;
    }>>(Prisma.sql`
      WITH latest AS (
        SELECT id FROM oracle_customer_sync_runs
        WHERE organization_id=${organizationId}::uuid AND status='validating'
        ORDER BY extracted_at DESC NULLS LAST,started_at DESC LIMIT 1
      ), oracle AS (
        SELECT external_customer_code,
               CASE currency_code WHEN 'YR' THEN 'YER' WHEN 'YER' THEN 'YER'
                 WHEN 'SR' THEN 'SAR' WHEN 'SAR' THEN 'SAR'
                 WHEN '$' THEN 'USD' WHEN 'USD' THEN 'USD' END AS currency_code,
               CASE WHEN currency_code IN ('YR','YER','$','USD') THEN balance_foreign ELSE balance_local END AS oracle_amount
        FROM oracle_customer_balances_mirror WHERE sync_run_id=(SELECT id FROM latest)
      )
      SELECT c.id AS customer_id,c.external_customer_code,o.currency_code,o.oracle_amount,
             COALESCE(cb.accounting_balance,0) AS platform_amount
      FROM oracle o
      JOIN customers c ON c.organization_id=${organizationId}::uuid AND c.external_customer_code=o.external_customer_code
      LEFT JOIN customer_balances cb ON cb.customer_id=c.id AND cb.currency_code=o.currency_code
      WHERE o.currency_code IS NOT NULL AND ABS(COALESCE(cb.accounting_balance,0)-o.oracle_amount)>0.0001
    `);
    if (!differences.length) return { changed: 0, importJobId: null as string | null };
    const job = await tx.importJob.create({
      data: {
        organizationId,
        fileName: `oracle-balance-reconciliation-${Date.now()}.json`,
        fileHash: sha256(`oracle-balance-reconciliation:${organizationId}:${Date.now()}`),
        uploadedBy: publishedBy,
        status: 'completed',
        rowsTotal: differences.length,
        txnsInFile: 0,
        customersNew: 0,
        customersUpdated: new Set(differences.map((row) => row.customer_id)).size,
        txnsInserted: 0,
        txnsSkippedDuplicate: 0,
        errorsCount: 0,
      },
    });
    for (const row of differences) {
      await tx.customerBalance.upsert({
        where: { customerId_currencyCode: { customerId: row.customer_id, currencyCode: row.currency_code } },
        create: {
          customerId: row.customer_id,
          currencyCode: row.currency_code,
          openingDebit: row.oracle_amount.isPositive() ? row.oracle_amount : 0,
          openingCredit: row.oracle_amount.isNegative() ? row.oracle_amount.abs() : 0,
          accountingBalance: row.oracle_amount,
          lastImportJobId: job.id,
        },
        update: { accountingBalance: row.oracle_amount, lastImportJobId: job.id, updatedAt: new Date() },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: publishedBy,
        action: 'oracle_customer_balances_reconciled',
        entityTable: 'customer_balances',
        entityId: job.id,
        newValue: {
          changed: differences.length,
          samples: differences.slice(0, 20).map((row) => ({
            customerCode: row.external_customer_code,
            currency: row.currency_code,
            from: row.platform_amount.toString(),
            to: row.oracle_amount.toString(),
          })),
        },
        reason: 'Oracle current balance is the approved source of truth; Oracle remained read-only.',
      },
    });
    return { changed: differences.length, importJobId: job.id };
  }

  async initializeBaseline(options: {
    organizationId: string;
    sourceSchema: string;
    triggeredBy: string;
    minimumMovementDate: string;
    apply: boolean;
  }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.minimumMovementDate)) {
      throw new Error('minimumMovementDate must use YYYY-MM-DD.');
    }
    const [run, existingConfig] = await Promise.all([
      this.latestRun(options.organizationId, options.sourceSchema),
      this.readConfig(options.organizationId),
    ]);
    if (existingConfig?.baselineRunId) {
      throw new Error('The automatic movement publication baseline is already initialized.');
    }
    const counts = await this.prisma.$queryRaw<Array<{ customers: bigint; inventory: bigint }>>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM oracle_customer_movements_mirror WHERE sync_run_id = ${run.id}::uuid) AS customers,
        (SELECT COUNT(*) FROM oracle_inventory_movements_mirror WHERE sync_run_id = ${run.id}::uuid) AS inventory
    `);
    if (!options.apply) {
      return {
        applied: false,
        status: 'baseline_preview',
        runId: run.id,
        minimumMovementDate: options.minimumMovementDate,
        counts: { customers: Number(counts[0]?.customers ?? 0), inventory: Number(counts[0]?.inventory ?? 0) },
      };
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
      const configRows = await tx.$queryRaw<Array<{ value: PublicationConfig }>>(Prisma.sql`
        SELECT value FROM system_settings
        WHERE organization_id = ${options.organizationId}::uuid AND key = ${SETTING_KEY}
      `);
      if (configRows[0]?.value?.baselineRunId) {
        throw new Error('The automatic movement publication baseline was initialized concurrently.');
      }
      const batch = await tx.oracleMovementPublicationBatch.create({
        data: {
          organizationId: options.organizationId,
          sourceSchema: options.sourceSchema,
          sourceRunId: run.id,
          mode: 'baseline',
          status: 'processing',
          triggeredBy: options.triggeredBy,
        },
      });

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO oracle_movement_publication_ledger(
          organization_id, source_schema, movement_kind, source_fingerprint, source_hash,
          source_run_id, status, reason_code, publication_batch_id, platform_entity_id,
          details, published_at
        )
        SELECT m.organization_id, ${options.sourceSchema}, 'customer', m.source_fingerprint,
               m.source_hash, m.sync_run_id,
               CASE WHEN it.id IS NULL THEN 'baseline_historical' ELSE 'published' END,
               CASE WHEN it.id IS NULL THEN 'initial_baseline' ELSE 'previously_approved_phase39' END,
               ${batch.id}::uuid, it.id,
               jsonb_build_object('externalCustomerCode',m.external_customer_code,'documentDate',m.document_date,
                                  'documentType',m.document_type,'documentNumber',m.document_number),
               CASE WHEN it.id IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END
        FROM oracle_customer_movements_mirror m
        LEFT JOIN imported_transactions it
          ON it.line_hash = encode(digest('oracle-phase39:' || m.source_fingerprint,'sha256'),'hex')
         AND it.reversed_at IS NULL
        WHERE m.sync_run_id = ${run.id}::uuid
        ON CONFLICT (organization_id, source_schema, movement_kind, source_fingerprint) DO NOTHING
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO oracle_movement_publication_ledger(
          organization_id, source_schema, movement_kind, source_fingerprint, source_hash,
          source_run_id, status, reason_code, publication_batch_id, platform_entity_id,
          details, published_at
        )
        SELECT m.organization_id, ${options.sourceSchema}, 'inventory', m.source_fingerprint,
               m.source_hash, m.sync_run_id,
               CASE WHEN p.id IS NULL THEN 'baseline_historical' ELSE 'published' END,
               CASE WHEN p.id IS NULL THEN 'initial_baseline' ELSE 'previously_approved_phase39' END,
               ${batch.id}::uuid, p.id,
               jsonb_build_object('externalItemCode',m.external_item_code,'movementDate',m.movement_date,
                                  'documentType',m.document_type,'documentNumber',m.document_number),
               CASE WHEN p.id IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END
        FROM oracle_inventory_movements_mirror m
        LEFT JOIN published_inventory_movements p
          ON p.organization_id = m.organization_id
         AND p.source_schema = ${options.sourceSchema}
         AND p.source_fingerprint = m.source_fingerprint
         AND p.reversed_at IS NULL
        WHERE m.sync_run_id = ${run.id}::uuid
        ON CONFLICT (organization_id, source_schema, movement_kind, source_fingerprint) DO NOTHING
      `);

      const ledgerCounts = await tx.$queryRaw<Array<{ movement_kind: string; status: string; total: bigint }>>(Prisma.sql`
        SELECT movement_kind, status, COUNT(*) AS total
        FROM oracle_movement_publication_ledger
        WHERE publication_batch_id = ${batch.id}::uuid
        GROUP BY movement_kind, status
        ORDER BY movement_kind, status
      `);
      const config: PublicationConfig = {
        enabled: false,
        baselineRunId: run.id,
        minimumMovementDate: options.minimumMovementDate,
        customer: true,
        inventory: true,
        updatedAt: new Date().toISOString(),
      };
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO system_settings(organization_id,key,value)
        VALUES(${options.organizationId}::uuid,${SETTING_KEY},${JSON.stringify(config)}::jsonb)
        ON CONFLICT(organization_id,key) DO UPDATE SET value=EXCLUDED.value
      `);
      const normalizedCounts = ledgerCounts.reduce<Record<string, number>>((result, row) => {
        result[`${row.movement_kind}.${row.status}`] = Number(row.total);
        return result;
      }, {});
      await tx.oracleMovementPublicationBatch.update({
        where: { id: batch.id },
        data: { status: 'completed', completedAt: new Date(), counts: normalizedCounts },
      });
      await tx.auditLog.create({
        data: {
          userId: options.triggeredBy,
          action: 'oracle_movement_auto_publication_baseline_initialized',
          entityTable: 'oracle_movement_publication_batches',
          entityId: batch.id,
          newValue: config as unknown as Prisma.InputJsonValue,
          reason: 'Initial fingerprint baseline; all existing mirror movements are blocked from future automatic publication.',
        },
      });
      return { applied: true, status: 'baseline_initialized', batchId: batch.id, runId: run.id, counts: normalizedCounts, config };
    }, { maxWait: 20_000, timeout: 120_000 });
  }

  async configure(options: {
    organizationId: string;
    triggeredBy: string;
    enabled: boolean;
    apply: boolean;
  }) {
    const current = await this.readConfig(options.organizationId);
    if (!current?.baselineRunId) throw new Error('Initialize the movement publication baseline before changing the switch.');
    const next = { ...current, enabled: options.enabled, updatedAt: new Date().toISOString() };
    if (!options.apply) return { applied: false, status: 'configuration_preview', config: next };
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
      await tx.$executeRaw(Prisma.sql`
        UPDATE system_settings SET value=${JSON.stringify(next)}::jsonb
        WHERE organization_id=${options.organizationId}::uuid AND key=${SETTING_KEY}
      `);
      await tx.auditLog.create({
        data: {
          userId: options.triggeredBy,
          action: options.enabled ? 'oracle_movement_auto_publication_enabled' : 'oracle_movement_auto_publication_disabled',
          entityTable: 'system_settings',
          entityId: SETTING_KEY,
          oldValue: current as unknown as Prisma.InputJsonValue,
          newValue: next as unknown as Prisma.InputJsonValue,
          reason: 'Controlled automatic publication switch changed; Oracle remains read-only.',
        },
      });
    });
    return { applied: true, status: options.enabled ? 'enabled' : 'disabled', config: next };
  }

  private async customerCandidates(db: QueryClient, organizationId: string, sourceSchema: string, runId: string) {
    return db.$queryRaw<CustomerCandidate[]>(Prisma.sql`
      WITH mapped AS (
        SELECT m.*,
               c.id AS customer_id,
               c.status AS customer_status,
               CASE m.currency_code
                 WHEN 'YR' THEN 'YER' WHEN 'YER' THEN 'YER'
                 WHEN 'SR' THEN 'SAR' WHEN 'SAR' THEN 'SAR'
                 WHEN '$' THEN 'USD' WHEN 'USD' THEN 'USD'
               END AS platform_currency,
               CASE WHEN m.currency_code IN ('YR','YER','$','USD') THEN m.debit_foreign ELSE m.debit_local END AS platform_debit,
               CASE WHEN m.currency_code IN ('YR','YER','$','USD') THEN m.credit_foreign ELSE m.credit_local END AS platform_credit,
               dt.id AS document_type_id,
               (cur.code IS NOT NULL) AS currency_exists
        FROM oracle_customer_movements_mirror m
        LEFT JOIN customers c
          ON c.organization_id=m.organization_id AND c.external_customer_code=m.external_customer_code
        LEFT JOIN document_types dt
          ON dt.organization_id=m.organization_id AND dt.active
         AND dt.name = CASE
           WHEN m.document_type='1' THEN 'قيد يومية'
           WHEN m.document_type='2' AND COALESCE(m.document_jv_type,'1')='2' THEN 'سند قبض بنكي'
           WHEN m.document_type='2' THEN 'سند قبض نقدي'
           WHEN m.document_type='3' AND COALESCE(m.document_jv_type,'1')='2' THEN 'سند صرف بنكي'
           WHEN m.document_type='3' THEN 'سند صرف نقدي'
           WHEN m.document_type='4' THEN 'فاتورة المبيعات آجل'
           WHEN m.document_type='5' THEN 'فاتورة مردود المبيعات آجل'
           WHEN m.document_type='6' THEN 'فاتورة المشتريات آجل'
           WHEN m.document_type='8' THEN 'أمر توريد مخزني'
         END
        LEFT JOIN currencies cur ON cur.code = CASE m.currency_code
          WHEN 'YR' THEN 'YER' WHEN 'YER' THEN 'YER'
          WHEN 'SR' THEN 'SAR' WHEN 'SAR' THEN 'SAR'
          WHEN '$' THEN 'USD' WHEN 'USD' THEN 'USD' END
        WHERE m.sync_run_id=${runId}::uuid AND m.organization_id=${organizationId}::uuid
      ), source_groups AS (
        SELECT customer_id,platform_currency,document_date,document_type_id,COALESCE(document_number,'') document_number,
               SUM(platform_debit) source_group_debit,SUM(platform_credit) source_group_credit
        FROM mapped
        WHERE customer_id IS NOT NULL AND platform_currency IS NOT NULL AND document_type_id IS NOT NULL
        GROUP BY customer_id,platform_currency,document_date,document_type_id,COALESCE(document_number,'')
      ), platform_groups AS (
        SELECT customer_id,currency_code,tx_date,document_type_id,COALESCE(document_number,'') document_number,
               COUNT(*) platform_rows,SUM(debit) platform_group_debit,SUM(credit) platform_group_credit
        FROM imported_transactions
        WHERE reversed_at IS NULL
        GROUP BY customer_id,currency_code,tx_date,document_type_id,COALESCE(document_number,'')
      )
      SELECT m.id,m.source_fingerprint,m.source_hash,m.external_customer_code,m.currency_code,
             m.document_date,m.document_type,m.document_jv_type,m.document_number,m.description,m.reference_number,
             m.customer_id,m.customer_status,m.platform_currency,m.platform_debit,m.platform_credit,
             m.document_type_id,m.currency_exists,sg.source_group_debit,sg.source_group_credit,
             COALESCE(pg.platform_rows,0) platform_rows,
             COALESCE(pg.platform_group_debit,0) platform_group_debit,
             COALESCE(pg.platform_group_credit,0) platform_group_credit
      FROM mapped m
      LEFT JOIN source_groups sg
        ON sg.customer_id=m.customer_id AND sg.platform_currency=m.platform_currency
       AND sg.document_date=m.document_date AND sg.document_type_id=m.document_type_id
       AND sg.document_number=COALESCE(m.document_number,'')
      LEFT JOIN platform_groups pg
        ON pg.customer_id=m.customer_id AND pg.currency_code=m.platform_currency
       AND pg.tx_date=m.document_date AND pg.document_type_id=m.document_type_id
       AND pg.document_number=COALESCE(m.document_number,'')
      LEFT JOIN oracle_movement_publication_ledger l
        ON l.organization_id=m.organization_id AND l.source_schema=${sourceSchema}
       AND l.movement_kind='customer' AND l.source_fingerprint=m.source_fingerprint
      WHERE l.id IS NULL OR l.status='quarantined'
      ORDER BY m.document_date,m.external_customer_code,m.document_type,m.document_number,m.source_fingerprint
    `);
  }

  private classifyCustomer(rows: CustomerCandidate[], minimumDate: string): Classified<CustomerCandidate>[] {
    return rows.map((row) => {
      const key = [row.external_customer_code,row.platform_currency ?? row.currency_code,dateOnly(row.document_date),
        row.document_type,row.document_jv_type ?? '',row.document_number ?? ''].join('|');
      const details = {
        externalCustomerCode: row.external_customer_code,
        documentDate: dateOnly(row.document_date),
        documentType: row.document_type,
        documentJvType: row.document_jv_type,
        documentNumber: row.document_number,
        debit: row.platform_debit.toString(),
        credit: row.platform_credit.toString(),
      };
      if (!row.customer_id) return { row, action: 'quarantine', reasonCode: 'unknown_customer', businessKey: key, details };
      if (!row.platform_currency || !row.currency_exists) return { row, action: 'quarantine', reasonCode: 'unsupported_currency', businessKey: key, details };
      if (!row.document_type_id || row.document_type === '0') return { row, action: 'quarantine', reasonCode: 'unsupported_document_type', businessKey: key, details };
      if (row.platform_debit.isNegative() || row.platform_credit.isNegative() ||
          (row.platform_debit.isZero() && row.platform_credit.isZero()) ||
          (!row.platform_debit.isZero() && !row.platform_credit.isZero())) {
        return { row, action: 'quarantine', reasonCode: 'invalid_single_side_amount', businessKey: key, details };
      }
      if (row.platform_rows > 0n) {
        const exact = sameAmount(row.source_group_debit, row.platform_group_debit) &&
          sameAmount(row.source_group_credit, row.platform_group_credit);
        return exact
          ? { row, action: 'ignore', reasonCode: 'already_exists_same_business_key_and_amount', businessKey: key, details }
          : { row, action: 'publish', reasonCode: 'oracle_amount_override_published', businessKey: key,
              details: { ...details, sourceGroupDebit: row.source_group_debit?.toString(), sourceGroupCredit: row.source_group_credit?.toString(),
                platformGroupDebit: row.platform_group_debit.toString(), platformGroupCredit: row.platform_group_credit.toString() } };
      }
      if (dateOnly(row.document_date) < minimumDate) {
        return { row, action: 'publish', reasonCode: 'historical_after_baseline_published', businessKey: key, details };
      }
      return { row, action: 'publish', reasonCode: 'new_after_baseline', businessKey: key, details };
    });
  }

  private async inventoryCandidates(db: QueryClient, organizationId: string, sourceSchema: string, runId: string) {
    return db.$queryRaw<InventoryCandidate[]>(Prisma.sql`
      SELECT m.id,m.source_fingerprint,m.source_hash,m.movement_date,m.document_type,m.document_number,
             m.document_sequence,m.serial_number,m.external_item_code,m.unit_name,m.package_size,
             m.item_quantity,m.free_quantity,m.primary_quantity,m.primary_free_quantity,m.in_out,
             m.external_warehouse_code,m.external_warehouse_group_code,m.description,m.reference_number,m.barcode,
             m.external_customer_code,
             (i.id IS NOT NULL) item_exists,(u.id IS NOT NULL) unit_exists,(w.id IS NOT NULL) warehouse_exists,
             CASE WHEN published.id IS NULL THEN 0 ELSE 1 END::bigint existing_business_rows,
             published.package_size existing_package_size,published.item_quantity existing_item_quantity,
             published.free_quantity existing_free_quantity,published.primary_quantity existing_primary_quantity,
             published.primary_free_quantity existing_primary_free_quantity,published.in_out existing_in_out,
             published.external_warehouse_group_code existing_warehouse_group_code,
             published.description existing_description,published.reference_number existing_reference_number,
             published.barcode existing_barcode
      FROM oracle_inventory_movements_mirror m
      LEFT JOIN oracle_inventory_active_snapshots a
        ON a.organization_id=m.organization_id AND a.source_schema=${sourceSchema}
      LEFT JOIN oracle_items_mirror i
        ON i.sync_run_id=a.active_run_id AND i.external_item_code=m.external_item_code
      LEFT JOIN oracle_item_units_mirror u
        ON u.sync_run_id=a.active_run_id AND u.external_item_code=m.external_item_code
       AND u.unit_name=m.unit_name AND u.package_size=m.package_size
      LEFT JOIN oracle_warehouses_mirror w
        ON w.sync_run_id=a.active_run_id AND w.external_warehouse_code=m.external_warehouse_code
      LEFT JOIN oracle_movement_publication_ledger l
        ON l.organization_id=m.organization_id AND l.source_schema=${sourceSchema}
       AND l.movement_kind='inventory' AND l.source_fingerprint=m.source_fingerprint
      LEFT JOIN LATERAL (
        SELECT p.* FROM published_inventory_movements p
        WHERE p.organization_id=m.organization_id AND p.source_schema=${sourceSchema} AND p.reversed_at IS NULL
          AND p.movement_date=m.movement_date AND p.document_type=m.document_type
          AND p.document_number=m.document_number AND p.document_sequence=m.document_sequence
          AND p.serial_number=m.serial_number AND p.external_item_code=m.external_item_code
          AND p.unit_name=m.unit_name AND p.external_warehouse_code=m.external_warehouse_code
        ORDER BY p.published_at DESC LIMIT 1
      ) published ON TRUE
      WHERE m.sync_run_id=${runId}::uuid AND m.organization_id=${organizationId}::uuid
        AND (l.id IS NULL OR l.status='quarantined')
      ORDER BY m.movement_date,m.external_item_code,m.document_type,m.document_number,m.source_fingerprint
    `);
  }

  private classifyInventory(rows: InventoryCandidate[], minimumDate: string): Classified<InventoryCandidate>[] {
    return rows.map((row) => {
      const key = [dateOnly(row.movement_date),row.document_type,row.document_number,row.document_sequence,
        row.serial_number,row.external_item_code,row.unit_name,row.external_warehouse_code].join('|');
      const details = { externalItemCode: row.external_item_code, movementDate: dateOnly(row.movement_date),
        documentType: row.document_type, documentNumber: row.document_number, warehouseCode: row.external_warehouse_code,
        unitName: row.unit_name, inOut: row.in_out, primaryQuantity: row.primary_quantity.toString(),
        primaryFreeQuantity: row.primary_free_quantity.toString(), externalCustomerCode: row.external_customer_code };
      if (!row.item_exists) return { row, action: 'quarantine', reasonCode: 'unknown_item_in_active_snapshot', businessKey: key, details };
      if (!row.unit_exists) return { row, action: 'quarantine', reasonCode: 'unknown_item_unit_in_active_snapshot', businessKey: key, details };
      if (!row.warehouse_exists) return { row, action: 'quarantine', reasonCode: 'unknown_warehouse_in_active_snapshot', businessKey: key, details };
      if (![-1,1].includes(row.in_out)) return { row, action: 'quarantine', reasonCode: 'invalid_inventory_direction', businessKey: key, details };
      if (!row.package_size.isPositive() || row.item_quantity.isNegative() || row.free_quantity.isNegative() ||
          row.primary_quantity.isNegative() || row.primary_free_quantity.isNegative()) {
        return { row, action: 'quarantine', reasonCode: 'invalid_inventory_quantity', businessKey: key, details };
      }
      if (row.existing_business_rows > 0n) {
        const sameInventoryImpact = row.existing_package_size !== null
          && sameAmount(row.existing_package_size, row.package_size)
          && sameAmount(row.existing_item_quantity, row.item_quantity)
          && sameAmount(row.existing_free_quantity, row.free_quantity)
          && sameAmount(row.existing_primary_quantity, row.primary_quantity)
          && sameAmount(row.existing_primary_free_quantity, row.primary_free_quantity)
          && row.existing_in_out === row.in_out
          && row.existing_warehouse_group_code === row.external_warehouse_group_code;
        if (sameInventoryImpact) {
          return {
            row,
            action: 'ignore',
            reasonCode: 'already_exists_same_inventory_impact',
            businessKey: key,
            details: {
              ...details,
              metadataChanged: row.existing_description !== row.description
                || row.existing_reference_number !== row.reference_number
                || row.existing_barcode !== row.barcode,
              publishedDescription: row.existing_description,
              oracleDescription: row.description,
            },
          };
        }
        return { row, action: 'publish', reasonCode: 'oracle_inventory_revision_published', businessKey: key, details };
      }
      if (dateOnly(row.movement_date) < minimumDate) {
        const reasonCode = row.document_type === '3' && row.in_out === 1
          ? 'historical_sales_return_published'
          : 'historical_after_baseline_published';
        return { row, action: 'publish', reasonCode, businessKey: key, details };
      }
      return { row, action: 'publish', reasonCode: 'new_after_baseline', businessKey: key, details };
    });
  }

  private async saveLedger(
    tx: Prisma.TransactionClient,
    options: { organizationId: string; sourceSchema: string; runId: string; batchId: string },
    item: Classified<CustomerCandidate | InventoryCandidate>,
    movementKind: 'customer' | 'inventory',
    platformEntityId?: string,
  ) {
    const status = item.action === 'publish' ? 'published' : item.action === 'ignore' ? 'ignored_duplicate' : 'quarantined';
    const now = new Date();
    await tx.oracleMovementPublicationLedger.upsert({
      where: { organizationId_sourceSchema_movementKind_sourceFingerprint: {
        organizationId: options.organizationId,
        sourceSchema: options.sourceSchema,
        movementKind,
        sourceFingerprint: item.row.source_fingerprint,
      } },
      create: {
        organizationId: options.organizationId,
        sourceSchema: options.sourceSchema,
        movementKind,
        sourceFingerprint: item.row.source_fingerprint,
        sourceHash: item.row.source_hash,
        sourceRunId: options.runId,
        status,
        reasonCode: item.reasonCode,
        businessKey: item.businessKey,
        publicationBatchId: options.batchId,
        platformEntityId: platformEntityId ?? null,
        details: item.details as Prisma.InputJsonValue,
        publishedAt: item.action === 'publish' ? now : null,
      },
      update: {
        sourceHash: item.row.source_hash,
        sourceRunId: options.runId,
        status,
        reasonCode: item.reasonCode,
        businessKey: item.businessKey,
        publicationBatchId: options.batchId,
        platformEntityId: platformEntityId ?? null,
        details: item.details as Prisma.InputJsonValue,
        lastSeenAt: now,
        publishedAt: item.action === 'publish' ? now : null,
        reversedAt: null,
      },
    });
  }

  async publish(options: {
    organizationId: string;
    sourceSchema: string;
    publishedBy: string;
    apply: boolean;
  }) {
    const config = await this.readConfig(options.organizationId);
    if (!config?.baselineRunId) return { applied: false, status: 'baseline_required' };
    if (!config.enabled) return { applied: false, status: 'disabled', config };
    const run = await this.latestRun(options.organizationId, options.sourceSchema);

    const execute = async (db: QueryClient) => {
      const [customerRows, inventoryRows] = await Promise.all([
        config.customer ? this.customerCandidates(db, options.organizationId, options.sourceSchema, run.id) : Promise.resolve([]),
        config.inventory ? this.inventoryCandidates(db, options.organizationId, options.sourceSchema, run.id) : Promise.resolve([]),
      ]);
      return {
        customers: this.classifyCustomer(customerRows, config.minimumMovementDate),
        inventory: this.classifyInventory(inventoryRows, config.minimumMovementDate),
      };
    };

    if (!options.apply) {
      const classified = await execute(this.prisma);
      return { applied: false, status: 'publication_preview', runId: run.id, counts: this.counts(classified), exceptions: this.exceptions(classified) };
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
      const currentRows = await tx.$queryRaw<Array<{ value: PublicationConfig }>>(Prisma.sql`
        SELECT value FROM system_settings
        WHERE organization_id=${options.organizationId}::uuid AND key=${SETTING_KEY}
        FOR UPDATE
      `);
      if (!currentRows[0]?.value?.enabled) return { applied: false, status: 'disabled_during_lock' };
      const customersCreated = await this.ensureNewCustomersFromLatestMirror(tx, options.organizationId);
      const classified = await execute(tx);
      const counts = { ...this.counts(classified), customersCreated };
      if (counts.totalCandidates === 0) {
        const balanceReconciliation = await this.reconcileCurrentCustomerBalances(tx, options.organizationId, options.publishedBy);
        return { applied: true, status: 'no_new_movements', runId: run.id, counts: { ...counts, balanceReconciliation } };
      }

      const batch = await tx.oracleMovementPublicationBatch.create({
        data: { organizationId: options.organizationId, sourceSchema: options.sourceSchema, sourceRunId: run.id,
          mode: 'automatic', status: 'processing', triggeredBy: options.publishedBy },
      });
      const customerPublishes = classified.customers.filter((item) => item.action === 'publish');
      let importJobId: string | null = null;
      if (customerPublishes.length > 0) {
        const job = await tx.importJob.create({
          data: {
            organizationId: options.organizationId,
            fileName: `oracle-auto-${batch.id}.json`,
            fileHash: sha256(`oracle-auto-batch:${batch.id}`),
            uploadedBy: options.publishedBy,
            status: 'completed',
            rowsTotal: classified.customers.length,
            txnsInFile: customerPublishes.length,
            customersNew: 0,
            customersUpdated: new Set(customerPublishes.map((item) => item.row.customer_id)).size,
            txnsInserted: customerPublishes.length,
            txnsSkippedDuplicate: classified.customers.filter((item) => item.action === 'ignore').length,
            errorsCount: classified.customers.filter((item) => item.action === 'quarantine').length,
            errorReport: this.exceptions({ customers: classified.customers, inventory: [] }) as Prisma.InputJsonValue,
          },
        });
        importJobId = job.id;
      }

      const balanceDeltas = new Map<string, { customerId: string; currencyCode: string; delta: Prisma.Decimal }>();
      const addBalanceDelta = (customerId: string, currencyCode: string, delta: Prisma.Decimal) => {
        const deltaKey = `${customerId}|${currencyCode}`;
        const previous = balanceDeltas.get(deltaKey);
        balanceDeltas.set(deltaKey, {
          customerId,
          currencyCode,
          delta: previous ? previous.delta.plus(delta) : delta,
        });
      };
      const replacedCustomerGroups = new Set<string>();
      for (const item of classified.customers) {
        let platformEntityId: string | undefined;
        if (item.action === 'publish') {
          const row = item.row;
          if (item.reasonCode === 'oracle_amount_override_published' && !replacedCustomerGroups.has(item.businessKey)) {
            const previousRows = await tx.importedTransaction.findMany({
              where: {
                customerId: row.customer_id!,
                currencyCode: row.platform_currency!,
                txDate: row.document_date,
                documentTypeId: row.document_type_id!,
                documentNumber: row.document_number,
                reversedAt: null,
              },
              select: { id: true, debit: true, credit: true },
            });
            if (previousRows.length) {
              await tx.importedTransaction.updateMany({
                where: { id: { in: previousRows.map((previous) => previous.id) }, reversedAt: null },
                data: { reversedAt: new Date() },
              });
              const previousImpact = previousRows.reduce(
                (sum, previous) => sum.plus(previous.debit).minus(previous.credit),
                new Prisma.Decimal(0),
              );
              addBalanceDelta(row.customer_id!, row.platform_currency!, previousImpact.negated());
            }
            replacedCustomerGroups.add(item.businessKey);
          }
          const transaction = await tx.importedTransaction.create({
            data: {
              customerId: row.customer_id!,
              currencyCode: row.platform_currency!,
              documentTypeId: row.document_type_id!,
              txDate: row.document_date,
              documentNumber: row.document_number,
              description: row.description,
              referenceNumber: row.reference_number,
              debit: decimal4(row.platform_debit),
              credit: decimal4(row.platform_credit),
              lineHash: sha256(`oracle-auto:${row.source_fingerprint}`),
              importJobId: importJobId!,
            },
          });
          platformEntityId = transaction.id;
          const delta = decimal4(row.platform_debit).minus(decimal4(row.platform_credit));
          addBalanceDelta(row.customer_id!, row.platform_currency!, delta);
        }
        await this.saveLedger(tx, { organizationId: options.organizationId, sourceSchema: options.sourceSchema, runId: run.id, batchId: batch.id }, item, 'customer', platformEntityId);
      }
      for (const value of balanceDeltas.values()) {
        await tx.customerBalance.upsert({
          where: { customerId_currencyCode: { customerId: value.customerId, currencyCode: value.currencyCode } },
          create: { customerId: value.customerId, currencyCode: value.currencyCode, openingDebit: 0, openingCredit: 0,
            accountingBalance: value.delta, lastImportJobId: importJobId },
          update: { accountingBalance: { increment: value.delta }, lastImportJobId: importJobId, updatedAt: new Date() },
        });
      }

      for (const item of classified.inventory) {
        let platformEntityId: string | undefined;
        if (item.action === 'publish') {
          const row = item.row;
          if (item.reasonCode === 'oracle_inventory_revision_published') {
            await tx.publishedInventoryMovement.updateMany({
              where: {
                organizationId: options.organizationId,
                sourceSchema: options.sourceSchema,
                movementDate: row.movement_date,
                documentType: row.document_type,
                documentNumber: row.document_number,
                documentSequence: row.document_sequence,
                serialNumber: row.serial_number,
                externalItemCode: row.external_item_code,
                unitName: row.unit_name,
                externalWarehouseCode: row.external_warehouse_code,
                reversedAt: null,
              },
              data: { reversedAt: new Date() },
            });
          }
          const movement = await tx.publishedInventoryMovement.create({
            data: {
              organizationId: options.organizationId,
              sourceSchema: options.sourceSchema,
              sourceRunId: run.id,
              sourceFingerprint: row.source_fingerprint,
              publicationBatchId: batch.id,
              externalItemCode: row.external_item_code,
              movementDate: row.movement_date,
              documentType: row.document_type,
              documentNumber: row.document_number,
              documentSequence: row.document_sequence,
              serialNumber: row.serial_number,
              unitName: row.unit_name,
              packageSize: row.package_size,
              itemQuantity: row.item_quantity,
              freeQuantity: row.free_quantity,
              primaryQuantity: row.primary_quantity,
              primaryFreeQuantity: row.primary_free_quantity,
              inOut: row.in_out,
              externalWarehouseCode: row.external_warehouse_code,
              externalWarehouseGroupCode: row.external_warehouse_group_code,
              description: row.description,
              referenceNumber: row.reference_number,
              barcode: row.barcode,
              publishedBy: options.publishedBy,
            },
          });
          platformEntityId = movement.id;
        }
        await this.saveLedger(tx, { organizationId: options.organizationId, sourceSchema: options.sourceSchema, runId: run.id, batchId: batch.id }, item, 'inventory', platformEntityId);
      }
      const balanceReconciliation = await this.reconcileCurrentCustomerBalances(tx, options.organizationId, options.publishedBy);
      const finalCounts = { ...counts, balanceReconciliation };
      await tx.oracleMovementPublicationBatch.update({ where: { id: batch.id }, data: { status: 'completed', completedAt: new Date(), counts: finalCounts } });
      const alertCounts = [...classified.customers, ...classified.inventory].reduce<Record<string, number>>((result, item) => {
        if (['historical_after_baseline_published', 'historical_sales_return_published',
          'oracle_amount_override_published', 'oracle_inventory_revision_published'].includes(item.reasonCode)) {
          result[item.reasonCode] = (result[item.reasonCode] ?? 0) + 1;
        }
        return result;
      }, {});
      if (Object.keys(alertCounts).length) {
        await tx.notification.create({
          data: {
            userId: options.publishedBy,
            kind: 'oracle_exception_movement_published',
            payload: {
              title: 'نشر حركة Oracle استثنائية',
              message: 'نُشرت حركة تاريخية أو معدلة وفق Oracle مع حفظ سجل المراجعة.',
              href: '/admin/oracle-monitoring/exceptions',
              batchId: batch.id,
              counts: alertCounts,
            },
          },
        });
      }
      await tx.auditLog.create({ data: {
        userId: options.publishedBy,
        action: 'oracle_new_movements_auto_published',
        entityTable: 'oracle_movement_publication_batches',
        entityId: batch.id,
        newValue: finalCounts as unknown as Prisma.InputJsonValue,
        reason: 'New, historical, returned, and revised Oracle movements were published append-only with alerts. Invalid references remain quarantined; Oracle was read-only.',
      } });
      return { applied: true, status: 'completed', batchId: batch.id, importJobId, runId: run.id, counts: finalCounts, exceptions: this.exceptions(classified) };
    }, { maxWait: 20_000, timeout: 120_000 });
  }

  private counts(classified: { customers: Classified<CustomerCandidate>[]; inventory: Classified<InventoryCandidate>[] }) {
    const count = <T>(items: Classified<T>[], action: Classified<T>['action']) => items.filter((item) => item.action === action).length;
    return {
      totalCandidates: classified.customers.length + classified.inventory.length,
      customers: { candidates: classified.customers.length, published: count(classified.customers,'publish'),
        ignored: count(classified.customers,'ignore'), quarantined: count(classified.customers,'quarantine') },
      inventory: { candidates: classified.inventory.length, published: count(classified.inventory,'publish'),
        ignored: count(classified.inventory,'ignore'), quarantined: count(classified.inventory,'quarantine') },
    };
  }

  private exceptions(classified: { customers: Classified<CustomerCandidate>[]; inventory: Classified<InventoryCandidate>[] }) {
    return [...classified.customers.map((item) => ({ kind: 'customer', ...item })),
      ...classified.inventory.map((item) => ({ kind: 'inventory', ...item }))]
      .filter((item) => item.action === 'quarantine')
      .map((item) => ({ kind: item.kind, fingerprint: item.row.source_fingerprint, reasonCode: item.reasonCode,
        businessKey: item.businessKey, details: item.details }));
  }

  async rollback(options: { organizationId: string; batchId: string; reversedBy: string; apply: boolean }) {
    const batch = await this.prisma.oracleMovementPublicationBatch.findFirst({
      where: { id: options.batchId, organizationId: options.organizationId },
    });
    if (!batch || batch.mode !== 'automatic' || batch.status !== 'completed') {
      throw new Error('The requested automatic publication batch is not eligible for rollback.');
    }
    const rows = await this.prisma.oracleMovementPublicationLedger.findMany({
      where: { publicationBatchId: batch.id, status: 'published', reversedAt: null },
      select: { id: true, movementKind: true, platformEntityId: true },
    });
    if (!options.apply) return { applied: false, status: 'rollback_preview', batchId: batch.id, rows: rows.length };
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
      const customerIds = rows.filter((row) => row.movementKind === 'customer' && row.platformEntityId).map((row) => row.platformEntityId!);
      const inventoryIds = rows.filter((row) => row.movementKind === 'inventory' && row.platformEntityId).map((row) => row.platformEntityId!);
      const affected = customerIds.length ? await tx.importedTransaction.findMany({
        where: { id: { in: customerIds }, reversedAt: null }, select: { id: true, customerId: true, currencyCode: true, importJobId: true },
      }) : [];
      if (customerIds.length) await tx.importedTransaction.updateMany({ where: { id: { in: customerIds }, reversedAt: null }, data: { reversedAt: new Date() } });
      if (inventoryIds.length) await tx.publishedInventoryMovement.updateMany({ where: { id: { in: inventoryIds }, reversedAt: null }, data: { reversedAt: new Date() } });
      const balanceKeys = new Map(affected.map((row) => [`${row.customerId}|${row.currencyCode}`, row]));
      for (const row of balanceKeys.values()) {
        const balance = await tx.customerBalance.findUnique({ where: { customerId_currencyCode: { customerId: row.customerId, currencyCode: row.currencyCode } } });
        if (!balance) continue;
        const totals = await tx.importedTransaction.aggregate({ where: { customerId: row.customerId, currencyCode: row.currencyCode, reversedAt: null },
          _sum: { debit: true, credit: true } });
        const accounting = balance.openingDebit.minus(balance.openingCredit)
          .plus(totals._sum.debit ?? 0).minus(totals._sum.credit ?? 0);
        await tx.customerBalance.update({ where: { id: balance.id }, data: { accountingBalance: accounting, updatedAt: new Date() } });
      }
      const jobIds = [...new Set(affected.map((row) => row.importJobId))];
      if (jobIds.length) await tx.importJob.updateMany({ where: { id: { in: jobIds }, reversedAt: null },
        data: { status: 'reversed', reversedBy: options.reversedBy, reversedAt: new Date(), reversalReason: `Rollback automatic Oracle publication batch ${batch.id}` } });
      await tx.oracleMovementPublicationLedger.updateMany({ where: { publicationBatchId: batch.id, status: 'published', reversedAt: null },
        data: { status: 'reversed', reversedAt: new Date(), reasonCode: 'batch_rollback' } });
      await tx.oracleMovementPublicationBatch.update({ where: { id: batch.id }, data: { status: 'reversed', completedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: options.reversedBy, action: 'oracle_movement_auto_publication_reversed',
        entityTable: 'oracle_movement_publication_batches', entityId: batch.id,
        reason: 'Non-destructive rollback: platform rows were reversed and Oracle remained unchanged.' } });
      return { applied: true, status: 'reversed', batchId: batch.id, customerRows: customerIds.length, inventoryRows: inventoryIds.length };
    }, { maxWait: 20_000, timeout: 120_000 });
  }
}
