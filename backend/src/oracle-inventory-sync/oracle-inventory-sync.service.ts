import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OracleInventorySnapshot, OracleInventorySnapshotService } from './oracle-inventory-snapshot.service';

export interface OracleInventoryLoadOptions {
  snapshotDirectory: string;
  organizationId: string;
  triggeredBy?: string;
  apply: boolean;
}

export interface OracleInventoryLoadResult {
  applied: boolean;
  syncRunId: string | null;
  sourceSchema: string;
  manifestHash: string;
  counts: Record<string, number>;
  status: 'validated_dry_run' | 'validating';
}

@Injectable()
export class OracleInventorySyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: OracleInventorySnapshotService,
  ) {}

  async run(options: OracleInventoryLoadOptions): Promise<OracleInventoryLoadResult> {
    const snapshot = await this.snapshots.inspect(options.snapshotDirectory);
    if (!options.apply) return this.result(snapshot, false, null, 'validated_dry_run');

    await this.assertPlatformScope(options.organizationId, options.triggeredBy);
    const active = await this.prisma.oracleInventoryActiveSnapshot.findUnique({
      where: {
        organizationId_sourceSchema: {
          organizationId: options.organizationId,
          sourceSchema: snapshot.sourceSchema,
        },
      },
      select: { activeRunId: true },
    });
    const run = await this.prisma.oracleInventorySyncRun.create({
      data: {
        organizationId: options.organizationId,
        sourceSchema: snapshot.sourceSchema,
        status: 'extracting',
        previousRunId: active?.activeRunId ?? null,
        triggeredBy: options.triggeredBy ?? null,
        extractedAt: snapshot.generatedAt,
        sourceCounts: snapshot.sourceCounts as Prisma.InputJsonValue,
        manifestHash: snapshot.manifestHash,
      },
      select: { id: true },
    });

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.insertBatches(snapshot.itemGroups, (rows) => tx.oracleItemGroupMirror.createMany({
          data: rows.map((row) => ({ ...row, syncRunId: run.id, organizationId: options.organizationId })),
        }));
        await this.insertBatches(snapshot.items, (rows) => tx.oracleItemMirror.createMany({
          data: rows.map((row) => ({ ...row, syncRunId: run.id, organizationId: options.organizationId })),
        }));
        await this.insertBatches(snapshot.itemUnits, (rows) => tx.oracleItemUnitMirror.createMany({
          data: rows.map((row) => ({ ...row, syncRunId: run.id, organizationId: options.organizationId })),
        }));
        await this.insertBatches(snapshot.warehouseGroups, (rows) => tx.oracleWarehouseGroupMirror.createMany({
          data: rows.map((row) => ({ ...row, syncRunId: run.id, organizationId: options.organizationId })),
        }));
        await this.insertBatches(snapshot.warehouses, (rows) => tx.oracleWarehouseMirror.createMany({
          data: rows.map((row) => ({ ...row, syncRunId: run.id, organizationId: options.organizationId })),
        }));
        await this.insertBatches(snapshot.stockBalances, (rows) => tx.oracleStockBalanceMirror.createMany({
          data: rows.map((row) => ({ ...row, syncRunId: run.id, organizationId: options.organizationId })),
        }));
        await tx.oracleInventorySyncRun.update({
          where: { id: run.id },
          data: {
            status: 'validating',
            loadedCounts: snapshot.sourceCounts as Prisma.InputJsonValue,
            validationSummary: snapshot.validationSummary as Prisma.InputJsonValue,
          },
        });
      }, { maxWait: 10_000, timeout: 120_000 });
    } catch (error) {
      await this.prisma.oracleInventorySyncRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          errorSummary: {
            type: error instanceof Error ? error.name : 'UnknownError',
            message: 'Snapshot loading failed; details are available in protected server logs.',
          },
        },
      });
      throw error;
    }

    return this.result(snapshot, true, run.id, 'validating');
  }

  private async assertPlatformScope(organizationId: string, triggeredBy?: string): Promise<void> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!organization) throw new Error('The target organization does not exist.');
    if (triggeredBy) {
      const user = await this.prisma.user.findFirst({ where: { id: triggeredBy, organizationId }, select: { id: true } });
      if (!user) throw new Error('The triggering user does not belong to the target organization.');
    }
  }

  private async insertBatches<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>): Promise<void> {
    const batchSize = 500;
    for (let index = 0; index < rows.length; index += batchSize) {
      await insert(rows.slice(index, index + batchSize));
    }
  }

  private result(
    snapshot: OracleInventorySnapshot,
    applied: boolean,
    syncRunId: string | null,
    status: OracleInventoryLoadResult['status'],
  ): OracleInventoryLoadResult {
    return {
      applied,
      syncRunId,
      sourceSchema: snapshot.sourceSchema,
      manifestHash: snapshot.manifestHash,
      counts: snapshot.sourceCounts,
      status,
    };
  }
}
