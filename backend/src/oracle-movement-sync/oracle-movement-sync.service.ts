import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OracleMovementSnapshotService } from './oracle-movement-snapshot.service';

@Injectable()
export class OracleMovementSyncService {
  constructor(private readonly prisma: PrismaService, private readonly snapshots: OracleMovementSnapshotService) {}

  async run(options: { snapshotDirectory: string; organizationId: string; triggeredBy?: string; apply: boolean }) {
    const snapshot = await this.snapshots.inspect(options.snapshotDirectory);
    const organization = await this.prisma.organization.findUnique({ where: { id: options.organizationId }, select: { id: true } });
    if (!organization) throw new Error('The target organization does not exist.');
    if (!options.apply) return { applied: false, syncRunId: null, status: 'validated_dry_run', counts: snapshot.sourceCounts, validationSummary: snapshot.validationSummary };
    const run = await this.prisma.oracleMovementSyncRun.create({ data: { organizationId: options.organizationId, sourceSchema: snapshot.sourceSchema, status: 'extracting', triggeredBy: options.triggeredBy ?? null, extractedAt: snapshot.generatedAt, sourceCounts: snapshot.sourceCounts, manifestHash: snapshot.manifestHash }, select: { id: true } });
    try {
      await this.prisma.$transaction(async (tx) => {
        for (let index = 0; index < snapshot.customerMovements.length; index += 250) {
          await tx.oracleCustomerMovementMirror.createMany({ data: snapshot.customerMovements.slice(index,index+250).map((row) => ({ ...row, syncRunId: run.id, organizationId: options.organizationId })) });
        }
        for (let index = 0; index < snapshot.inventoryMovements.length; index += 250) {
          await tx.oracleInventoryMovementMirror.createMany({ data: snapshot.inventoryMovements.slice(index,index+250).map((row) => ({ ...row, syncRunId: run.id, organizationId: options.organizationId })) });
        }
        await tx.oracleMovementSyncRun.update({ where: { id: run.id }, data: { status: 'validated', validatedAt: new Date(), loadedCounts: snapshot.sourceCounts as Prisma.InputJsonValue, validationSummary: snapshot.validationSummary as Prisma.InputJsonValue } });
      }, { maxWait: 20_000, timeout: 600_000 });
    } catch (error) {
      await this.prisma.oracleMovementSyncRun.update({ where: { id: run.id }, data: { status: 'failed', errorSummary: { type: error instanceof Error ? error.name : 'UnknownError', message: 'Movement mirror loading failed; see protected logs.' } } });
      throw error;
    }
    return { applied: true, syncRunId: run.id, status: 'validated', counts: snapshot.sourceCounts, validationSummary: snapshot.validationSummary };
  }
}
