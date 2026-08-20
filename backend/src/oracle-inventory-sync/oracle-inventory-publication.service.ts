import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const COUNT_KEYS = [
  'item_groups',
  'items',
  'item_units',
  'warehouse_groups',
  'warehouses',
  'stock_balances',
] as const;

type CountKey = typeof COUNT_KEYS[number];
type IssueSeverity = 'warning' | 'error';

export interface OracleInventoryValidationIssue {
  severity: IssueSeverity;
  entityType: string;
  externalKey?: string;
  ruleCode: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface OracleInventoryValidationResult {
  runId: string;
  status: string;
  passed: boolean;
  errorCount: number;
  warningCount: number;
  counts: Record<CountKey, number>;
  checks: Record<string, number | boolean>;
  issues: OracleInventoryValidationIssue[];
}

export interface OracleInventoryPublicationResult {
  runId: string;
  published: boolean;
  status: 'published' | 'rejected';
  previousRunId: string | null;
  validation: OracleInventoryValidationResult;
}

export interface OracleInventoryRollbackResult {
  organizationId: string;
  sourceSchema: string;
  fromRunId: string;
  toRunId: string;
}

type DbClient = Prisma.TransactionClient | PrismaService;

function jsonCounts(value: Prisma.JsonValue | null): Partial<Record<CountKey, number>> {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  const object = value as Record<string, Prisma.JsonValue>;
  return Object.fromEntries(COUNT_KEYS.flatMap((key) => {
    const count = object[key];
    return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? [[key, count]] : [];
  }));
}

@Injectable()
export class OracleInventoryPublicationService {
  constructor(private readonly prisma: PrismaService) {}

  async validate(runId: string): Promise<OracleInventoryValidationResult> {
    return this.prisma.$transaction(
      (tx) => this.validateWithClient(tx, runId),
      { maxWait: 10_000, timeout: 120_000 },
    );
  }

  async publish(runId: string): Promise<OracleInventoryPublicationResult> {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.oracleInventorySyncRun.findUnique({
        where: { id: runId },
        select: { organizationId: true, sourceSchema: true, status: true },
      });
      if (!initial) throw new Error('Oracle inventory sync run was not found.');
      if (initial.status !== 'validating') throw new Error(`Only a validating run can be published; current status is ${initial.status}.`);

      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM organizations
        WHERE id = ${initial.organizationId}::uuid
        FOR UPDATE
      `);
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM oracle_inventory_sync_runs
        WHERE id = ${runId}::uuid
        FOR UPDATE
      `);

      const validation = await this.validateWithClient(tx, runId);
      const now = new Date();
      if (validation.issues.length > 0) {
        await tx.oracleSyncIssue.createMany({
          data: validation.issues.map((issue) => ({
            syncRunId: runId,
            organizationId: initial.organizationId,
            severity: issue.severity,
            entityType: issue.entityType,
            externalKey: issue.externalKey ?? null,
            ruleCode: issue.ruleCode,
            message: issue.message,
            details: issue.details as Prisma.InputJsonValue | undefined,
          })),
        });
      }

      const active = await tx.oracleInventoryActiveSnapshot.findUnique({
        where: {
          organizationId_sourceSchema: {
            organizationId: initial.organizationId,
            sourceSchema: initial.sourceSchema,
          },
        },
        select: { activeRunId: true },
      });

      if (!validation.passed) {
        await tx.oracleInventorySyncRun.update({
          where: { id: runId },
          data: {
            status: 'rejected',
            validatedAt: now,
            validationSummary: this.summary(validation) as Prisma.InputJsonValue,
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'oracle_inventory_snapshot_rejected',
            entityTable: 'oracle_inventory_sync_runs',
            entityId: runId,
            newValue: this.summary(validation) as Prisma.InputJsonValue,
            reason: 'Manual Batch C publication validation failed.',
          },
        });
        return { runId, published: false, status: 'rejected', previousRunId: active?.activeRunId ?? null, validation };
      }

      await tx.oracleInventorySyncRun.update({
        where: { id: runId },
        data: {
          status: 'published',
          validatedAt: now,
          publishedAt: now,
          validationSummary: this.summary(validation) as Prisma.InputJsonValue,
        },
      });
      await tx.oracleInventoryActiveSnapshot.upsert({
        where: {
          organizationId_sourceSchema: {
            organizationId: initial.organizationId,
            sourceSchema: initial.sourceSchema,
          },
        },
        create: {
          organizationId: initial.organizationId,
          sourceSchema: initial.sourceSchema,
          activeRunId: runId,
          previousRunId: active?.activeRunId ?? null,
          activatedAt: now,
        },
        update: {
          activeRunId: runId,
          previousRunId: active?.activeRunId ?? null,
          activatedAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'oracle_inventory_snapshot_published',
          entityTable: 'oracle_inventory_sync_runs',
          entityId: runId,
          oldValue: active ? { activeRunId: active.activeRunId } : Prisma.JsonNull,
          newValue: { activeRunId: runId, previousRunId: active?.activeRunId ?? null },
          reason: 'Manual Batch C publication after successful validation.',
        },
      });

      return { runId, published: true, status: 'published', previousRunId: active?.activeRunId ?? null, validation };
    }, { maxWait: 10_000, timeout: 120_000 });
  }

  async rollbackToPrevious(organizationId: string, sourceSchema: string): Promise<OracleInventoryRollbackResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM organizations
        WHERE id = ${organizationId}::uuid
        FOR UPDATE
      `);
      const active = await tx.oracleInventoryActiveSnapshot.findUnique({
        where: { organizationId_sourceSchema: { organizationId, sourceSchema } },
        select: { activeRunId: true, previousRunId: true },
      });
      if (!active) throw new Error('No active Oracle inventory snapshot exists for this scope.');
      if (!active.previousRunId) throw new Error('The active Oracle inventory snapshot has no previous run to restore.');
      const previous = await tx.oracleInventorySyncRun.findFirst({
        where: {
          id: active.previousRunId,
          organizationId,
          sourceSchema,
          status: 'published',
        },
        select: { id: true },
      });
      if (!previous) throw new Error('The previous Oracle inventory snapshot is not a published run in this scope.');

      const now = new Date();
      await tx.oracleInventoryActiveSnapshot.update({
        where: { organizationId_sourceSchema: { organizationId, sourceSchema } },
        data: {
          activeRunId: previous.id,
          previousRunId: active.activeRunId,
          activatedAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'oracle_inventory_snapshot_rolled_back',
          entityTable: 'oracle_inventory_active_snapshots',
          entityId: previous.id,
          oldValue: { activeRunId: active.activeRunId },
          newValue: { activeRunId: previous.id, previousRunId: active.activeRunId },
          reason: 'Manual rollback to the previous published Oracle inventory snapshot.',
        },
      });
      return {
        organizationId,
        sourceSchema,
        fromRunId: active.activeRunId,
        toRunId: previous.id,
      };
    }, { maxWait: 10_000, timeout: 120_000 });
  }

  private async validateWithClient(client: DbClient, runId: string): Promise<OracleInventoryValidationResult> {
    const run = await client.oracleInventorySyncRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        organizationId: true,
        sourceSchema: true,
        status: true,
        manifestHash: true,
        sourceCounts: true,
        loadedCounts: true,
      },
    });
    if (!run) throw new Error('Oracle inventory sync run was not found.');
    if (!['validating', 'published'].includes(run.status)) {
      throw new Error(`Oracle inventory sync run cannot be validated in status ${run.status}.`);
    }

    const [itemGroups, items, itemUnits, warehouseGroups, warehouses, stockBalances] = await Promise.all([
      client.oracleItemGroupMirror.count({ where: { syncRunId: runId } }),
      client.oracleItemMirror.count({ where: { syncRunId: runId } }),
      client.oracleItemUnitMirror.count({ where: { syncRunId: runId } }),
      client.oracleWarehouseGroupMirror.count({ where: { syncRunId: runId } }),
      client.oracleWarehouseMirror.count({ where: { syncRunId: runId } }),
      client.oracleStockBalanceMirror.count({ where: { syncRunId: runId } }),
    ]);
    const counts: Record<CountKey, number> = {
      item_groups: itemGroups,
      items,
      item_units: itemUnits,
      warehouse_groups: warehouseGroups,
      warehouses,
      stock_balances: stockBalances,
    };
    const sourceCounts = jsonCounts(run.sourceCounts);
    const loadedCounts = jsonCounts(run.loadedCounts);
    const issues: OracleInventoryValidationIssue[] = [];

    for (const key of COUNT_KEYS) {
      if (sourceCounts[key] !== counts[key]) {
        issues.push({
          severity: 'error', entityType: key, ruleCode: 'SOURCE_COUNT_MISMATCH',
          message: `Source count does not match stored rows for ${key}.`,
          details: { source: sourceCounts[key] ?? null, actual: counts[key] },
        });
      }
      if (loadedCounts[key] !== counts[key]) {
        issues.push({
          severity: 'error', entityType: key, ruleCode: 'LOADED_COUNT_MISMATCH',
          message: `Recorded loaded count does not match stored rows for ${key}.`,
          details: { loaded: loadedCounts[key] ?? null, actual: counts[key] },
        });
      }
    }
    if (!run.manifestHash || !/^[a-f0-9]{64}$/i.test(run.manifestHash)) {
      issues.push({
        severity: 'error', entityType: 'sync_run', externalKey: runId,
        ruleCode: 'MANIFEST_HASH_INVALID', message: 'The snapshot manifest hash is missing or invalid.',
      });
    }

    const [itemsWithoutUnits, invalidMainUnits, invalidSaleUnits, stockUnitMismatches, duplicateBarcodes] = await Promise.all([
      this.scalar(client, Prisma.sql`
        SELECT COUNT(*) FROM oracle_items_mirror i
        WHERE i.sync_run_id = ${runId}::uuid
          AND NOT EXISTS (
            SELECT 1 FROM oracle_item_units_mirror u
            WHERE u.sync_run_id = i.sync_run_id
              AND u.external_item_code = i.external_item_code
          )
      `),
      this.scalar(client, Prisma.sql`
        SELECT COUNT(*) FROM (
          SELECT i.external_item_code
          FROM oracle_items_mirror i
          LEFT JOIN oracle_item_units_mirror u
            ON u.sync_run_id = i.sync_run_id
           AND u.external_item_code = i.external_item_code
          WHERE i.sync_run_id = ${runId}::uuid
          GROUP BY i.external_item_code
          HAVING COUNT(*) FILTER (WHERE u.is_main_unit) <> 1
        ) invalid
      `),
      this.scalar(client, Prisma.sql`
        SELECT COUNT(*) FROM (
          SELECT i.external_item_code
          FROM oracle_items_mirror i
          LEFT JOIN oracle_item_units_mirror u
            ON u.sync_run_id = i.sync_run_id
           AND u.external_item_code = i.external_item_code
          WHERE i.sync_run_id = ${runId}::uuid
          GROUP BY i.external_item_code
          HAVING COUNT(*) FILTER (WHERE u.is_sale_unit) <> 1
        ) invalid
      `),
      this.scalar(client, Prisma.sql`
        SELECT COUNT(*) FROM oracle_stock_balances_mirror s
        WHERE s.sync_run_id = ${runId}::uuid
          AND NOT EXISTS (
            SELECT 1 FROM oracle_item_units_mirror u
            WHERE u.sync_run_id = s.sync_run_id
              AND u.external_item_code = s.external_item_code
              AND u.unit_name = s.unit_name
              AND u.package_size = s.package_size
          )
      `),
      this.scalar(client, Prisma.sql`
        SELECT COUNT(*) FROM (
          SELECT barcode FROM oracle_item_units_mirror
          WHERE sync_run_id = ${runId}::uuid AND barcode IS NOT NULL
          GROUP BY barcode HAVING COUNT(*) > 1
        ) duplicates
      `),
    ]);

    const ruleCounts: [string, string, number, string][] = [
      ['items', 'ITEM_WITHOUT_UNIT', itemsWithoutUnits, 'Item has no unit.'],
      ['item_units', 'INVALID_MAIN_UNIT_COUNT', invalidMainUnits, 'Item must have exactly one main unit.'],
      ['item_units', 'INVALID_SALE_UNIT_COUNT', invalidSaleUnits, 'Item must have exactly one sale unit.'],
      ['stock_balances', 'STOCK_UNIT_PACKAGE_MISMATCH', stockUnitMismatches, 'Stock row does not match an item unit and package size.'],
      ['item_units', 'DUPLICATE_BARCODE', duplicateBarcodes, 'Nonblank barcode is duplicated.'],
    ];
    for (const [entityType, ruleCode, count, message] of ruleCounts) {
      if (count > 0) issues.push({ severity: 'error', entityType, ruleCode, message, details: { count } });
    }

    const unmappedBranches = await client.$queryRaw<Array<{ external_branch_code: string }>>(Prisma.sql`
      SELECT DISTINCT w.external_branch_code
      FROM oracle_warehouses_mirror w
      WHERE w.sync_run_id = ${runId}::uuid
        AND w.external_branch_code IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM oracle_branch_mappings m
          WHERE m.organization_id = ${run.organizationId}::uuid
            AND m.source_schema = ${run.sourceSchema}
            AND m.external_branch_code = w.external_branch_code
            AND m.is_active = true
        )
      ORDER BY w.external_branch_code
    `);
    for (const branch of unmappedBranches) {
      issues.push({
        severity: 'warning', entityType: 'warehouse', externalKey: branch.external_branch_code,
        ruleCode: 'BRANCH_MAPPING_MISSING',
        message: 'Oracle warehouse branch has no verified platform branch mapping.',
      });
    }

    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
    return {
      runId,
      status: run.status,
      passed: errorCount === 0,
      errorCount,
      warningCount,
      counts,
      checks: {
        countsMatched: issues.every((issue) => !issue.ruleCode.endsWith('COUNT_MISMATCH')),
        manifestHashValid: !issues.some((issue) => issue.ruleCode === 'MANIFEST_HASH_INVALID'),
        itemsWithoutUnits,
        invalidMainUnits,
        invalidSaleUnits,
        stockUnitMismatches,
        duplicateBarcodes,
        unmappedBranches: unmappedBranches.length,
      },
      issues,
    };
  }

  private async scalar(client: DbClient, query: Prisma.Sql): Promise<number> {
    const rows = await client.$queryRaw<Array<{ count: bigint }>>(query);
    return Number(rows[0]?.count ?? 0);
  }

  private summary(validation: OracleInventoryValidationResult): Record<string, unknown> {
    return {
      passed: validation.passed,
      errorCount: validation.errorCount,
      warningCount: validation.warningCount,
      counts: validation.counts,
      checks: validation.checks,
    };
  }
}
