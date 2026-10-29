import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type HeartbeatRow = {
  source_schema: string;
  mirror_kind: 'customers' | 'inventory' | 'movements';
  last_checked_at: Date;
  last_success_at: Date | null;
  last_status: 'ok' | 'failed';
  last_changed: boolean;
  last_sync_run_id: string | null;
};

type RunRow = {
  id: string;
  source_schema: string;
  status: string;
  started_at: Date;
  extracted_at: Date | null;
  validated_at: Date | null;
  published_at: Date | null;
  loaded_counts: unknown;
  validation_summary: unknown;
  platform_comparison?: unknown;
  manifest_hash: string | null;
};

@Injectable()
export class OracleMonitoringService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private async directReadGateway() {
    const baseUrl = this.config.get<string>('ORACLE_READ_API_URL')?.trim().replace(/\/$/, '');
    const apiKey = this.config.get<string>('ORACLE_READ_API_KEY')?.trim();
    const expectedSchema = this.config.get<string>('ORACLE_READ_SCHEMA')?.trim().toUpperCase() || 'IAS20261';
    if (!baseUrl) return { configured: false, ready: false, status: 'missing', expectedSchema, message: 'بوابة القراءة غير مهيأة' };
    try {
      const response = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(4_000),
      });
      const body = await response.json().catch(() => null) as Record<string, unknown> | null;
      const capabilities = Array.isArray(body?.capabilities) ? body.capabilities.map(String) : [];
      const missingCapabilities = ['request-catalog', 'accounting-currencies']
        .filter((capability) => !capabilities.includes(capability));
      const ready = response.ok && body?.status === 'ok' && body?.mode === 'SELECT_ONLY'
        && missingCapabilities.length === 0;
      return {
        configured: true, ready, status: ready ? 'ok' : 'incompatible', expectedSchema,
        reportedSchema: typeof body?.schema === 'string' ? body.schema : null,
        capabilities, missingCapabilities,
        message: ready ? 'بوابة الأطراف والحسابات جاهزة' : 'بوابة القراءة تعمل بإصدار لا يوفر الأطراف والحسابات',
      };
    } catch (error) {
      return {
        configured: true, ready: false, status: 'offline', expectedSchema,
        message: error instanceof Error ? error.message : 'تعذر الاتصال ببوابة القراءة',
        capabilities: [], missingCapabilities: ['request-catalog', 'accounting-currencies'],
      };
    }
  }

  async summary(organizationId: string) {
    const [heartbeats, customerRuns, inventoryRuns, movementRuns, operational, activeInventory, publicationConfig, publicationLedger, publicationBatches, directReadGateway] = await Promise.all([
      this.prisma.$queryRaw<HeartbeatRow[]>(Prisma.sql`
        SELECT source_schema, mirror_kind, last_checked_at, last_success_at,
               last_status, last_changed, last_sync_run_id
        FROM oracle_mirror_heartbeats
        WHERE organization_id = ${organizationId}::uuid
        ORDER BY mirror_kind
      `),
      this.prisma.$queryRaw<RunRow[]>(Prisma.sql`
        SELECT id, source_schema, status, started_at, extracted_at, validated_at, published_at,
               loaded_counts, validation_summary, platform_comparison, manifest_hash
        FROM oracle_customer_sync_runs
        WHERE organization_id = ${organizationId}::uuid
        ORDER BY started_at DESC
        LIMIT 8
      `),
      this.prisma.$queryRaw<RunRow[]>(Prisma.sql`
        SELECT id, source_schema, status, started_at, extracted_at, validated_at, published_at,
               loaded_counts, validation_summary, manifest_hash
        FROM oracle_inventory_sync_runs
        WHERE organization_id = ${organizationId}::uuid
        ORDER BY started_at DESC
        LIMIT 8
      `),
      this.prisma.$queryRaw<RunRow[]>(Prisma.sql`
        SELECT id, source_schema, status, started_at, extracted_at, validated_at, published_at,
               loaded_counts, validation_summary, manifest_hash
        FROM oracle_movement_sync_runs
        WHERE organization_id = ${organizationId}::uuid
        ORDER BY started_at DESC
        LIMIT 8
      `),
      this.prisma.$queryRaw<Array<{ customers: bigint; balances: bigint }>>(Prisma.sql`
        SELECT
          (SELECT COUNT(*) FROM customers WHERE organization_id = ${organizationId}::uuid) AS customers,
          (SELECT COUNT(*)
             FROM customer_balances cb
             JOIN customers c ON c.id = cb.customer_id
            WHERE c.organization_id = ${organizationId}::uuid) AS balances
      `),
      this.prisma.$queryRaw<Array<{ active_run_id: string; activated_at: Date }>>(Prisma.sql`
        SELECT active_run_id, activated_at
        FROM oracle_inventory_active_snapshots
        WHERE organization_id = ${organizationId}::uuid
        ORDER BY activated_at DESC
        LIMIT 1
      `),
      this.prisma.$queryRaw<Array<{ value: Record<string, unknown> }>>(Prisma.sql`
        SELECT value
        FROM system_settings
        WHERE organization_id = ${organizationId}::uuid AND key = 'oracleMovementAutoPublish'
        LIMIT 1
      `),
      this.prisma.$queryRaw<Array<{ status: string; movement_kind: string; total: bigint }>>(Prisma.sql`
        SELECT status, movement_kind, COUNT(*) AS total
        FROM oracle_movement_publication_ledger
        WHERE organization_id = ${organizationId}::uuid
        GROUP BY status, movement_kind
        ORDER BY status, movement_kind
      `),
      this.prisma.$queryRaw<Array<{ id: string; status: string; source_run_id: string; started_at: Date; completed_at: Date | null; counts: unknown }>>(Prisma.sql`
        SELECT id,status,source_run_id,started_at,completed_at,counts
        FROM oracle_movement_publication_batches
        WHERE organization_id = ${organizationId}::uuid
        ORDER BY started_at DESC
        LIMIT 8
      `),
      this.directReadGateway(),
    ]);

    const now = Date.now();
    const heartbeatViews = heartbeats.map((row) => {
      const ageSeconds = Math.max(0, Math.floor((now - row.last_checked_at.getTime()) / 1000));
      const staleAfterSeconds = 12 * 60;
      return {
        sourceSchema: row.source_schema,
        kind: row.mirror_kind,
        lastCheckedAt: row.last_checked_at,
        lastSuccessAt: row.last_success_at,
        lastStatus: row.last_status,
        lastChanged: row.last_changed,
        lastSyncRunId: row.last_sync_run_id,
        ageSeconds,
        healthy: row.last_status === 'ok' && ageSeconds <= staleAfterSeconds,
      };
    });
    const expectedKinds = ['customers', 'inventory', 'movements'];
    const healthyKinds = heartbeatViews.filter((row) => row.healthy).length;
    const overallStatus = healthyKinds === expectedKinds.length && directReadGateway.ready
      ? 'healthy'
      : heartbeats.length === 0 && !directReadGateway.ready
        ? 'initializing'
        : healthyKinds > 0 || directReadGateway.ready
          ? 'degraded'
          : 'offline';

    const mapRun = (row: RunRow) => ({
      id: row.id,
      sourceSchema: row.source_schema,
      status: row.status,
      startedAt: row.started_at,
      extractedAt: row.extracted_at,
      validatedAt: row.validated_at,
      publishedAt: row.published_at,
      loadedCounts: row.loaded_counts,
      validationSummary: row.validation_summary,
      platformComparison: row.platform_comparison ?? null,
      manifestHash: row.manifest_hash,
    });

    return {
      mode: 'read_only_mirror',
      oracleWriteEnabled: false,
      scheduleMinutes: 5,
      staleAfterMinutes: 12,
      overallStatus,
      checkedAt: new Date(),
      heartbeats: heartbeatViews,
      directReadGateway,
      latest: {
        customers: customerRuns[0] ? mapRun(customerRuns[0]) : null,
        inventory: inventoryRuns[0] ? mapRun(inventoryRuns[0]) : null,
        movements: movementRuns[0] ? mapRun(movementRuns[0]) : null,
      },
      history: {
        customers: customerRuns.map(mapRun),
        inventory: inventoryRuns.map(mapRun),
        movements: movementRuns.map(mapRun),
      },
      operationalCounts: {
        customers: Number(operational[0]?.customers ?? 0),
        balances: Number(operational[0]?.balances ?? 0),
      },
      activePublishedInventory: activeInventory[0]
        ? { runId: activeInventory[0].active_run_id, activatedAt: activeInventory[0].activated_at }
        : null,
      automaticPublication: {
        configured: Boolean(publicationConfig[0]),
        config: publicationConfig[0]?.value ?? null,
        ledger: publicationLedger.map((row) => ({ status: row.status, kind: row.movement_kind, total: Number(row.total) })),
        quarantineCount: publicationLedger
          .filter((row) => row.status === 'quarantined')
          .reduce((total, row) => total + Number(row.total), 0),
        recentBatches: publicationBatches.map((row) => ({
          id: row.id,
          status: row.status,
          sourceRunId: row.source_run_id,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          counts: row.counts,
        })),
      },
    };
  }
}
