import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OracleCustomerSnapshot, OracleCustomerSnapshotService } from './oracle-customer-snapshot.service';

export interface OracleCustomerLoadOptions {
  snapshotDirectory: string;
  organizationId: string;
  triggeredBy?: string;
  apply: boolean;
}

export interface OracleCustomerLoadResult {
  applied: boolean;
  syncRunId: string | null;
  sourceSchema: string;
  manifestHash: string;
  counts: Record<string, number>;
  status: 'validated_dry_run' | 'validating';
  platformComparison: Record<string, unknown>;
}

@Injectable()
export class OracleCustomerSyncService {
  constructor(private readonly prisma: PrismaService, private readonly snapshots: OracleCustomerSnapshotService) {}

  async run(options: OracleCustomerLoadOptions): Promise<OracleCustomerLoadResult> {
    const snapshot = await this.snapshots.inspect(options.snapshotDirectory);
    await this.assertPlatformScope(options.organizationId, options.triggeredBy);
    const comparison = await this.compareWithPlatform(snapshot, options.organizationId);
    if (!options.apply) return this.result(snapshot, comparison, false, null, 'validated_dry_run');

    const run = await this.prisma.oracleCustomerSyncRun.create({
      data: {
        organizationId: options.organizationId,
        sourceSchema: snapshot.sourceSchema,
        status: 'extracting',
        triggeredBy: options.triggeredBy ?? null,
        extractedAt: snapshot.generatedAt,
        sourceCounts: snapshot.sourceCounts as Prisma.InputJsonValue,
        manifestHash: snapshot.manifestHash,
      },
      select: { id: true },
    });
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.insertBatches(snapshot.customers, (rows) => tx.oracleCustomerMirror.createMany({
          data: rows.map((row) => ({ ...row, syncRunId: run.id, organizationId: options.organizationId })),
        }));
        await this.insertBatches(snapshot.customerCurrencies, (rows) => tx.oracleCustomerCurrencyMirror.createMany({
          data: rows.map((row) => ({ ...row, syncRunId: run.id, organizationId: options.organizationId })),
        }));
        await this.insertBatches(snapshot.customerBalances, (rows) => tx.oracleCustomerBalanceMirror.createMany({
          data: rows.map((row) => ({ ...row, syncRunId: run.id, organizationId: options.organizationId })),
        }));
        await tx.oracleCustomerSyncRun.update({
          where: { id: run.id },
          data: {
            status: 'validating',
            loadedCounts: {
              customers: snapshot.customers.length,
              customer_currencies: snapshot.customerCurrencies.length,
              customer_balances: snapshot.customerBalances.length,
            },
            validationSummary: snapshot.validationSummary as Prisma.InputJsonValue,
            platformComparison: comparison as Prisma.InputJsonValue,
          },
        });
      }, { maxWait: 10_000, timeout: 120_000 });
    } catch (error) {
      await this.prisma.oracleCustomerSyncRun.update({
        where: { id: run.id },
        data: { status: 'failed', errorSummary: { type: error instanceof Error ? error.name : 'UnknownError', message: 'Customer mirror loading failed; details are available in protected server logs.' } },
      });
      throw error;
    }
    return this.result(snapshot, comparison, true, run.id, 'validating');
  }

  private async assertPlatformScope(organizationId: string, triggeredBy?: string): Promise<void> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!organization) throw new Error('The target organization does not exist.');
    if (triggeredBy) {
      const user = await this.prisma.user.findFirst({ where: { id: triggeredBy, organizationId }, select: { id: true } });
      if (!user) throw new Error('The triggering user does not belong to the target organization.');
    }
  }

  private async compareWithPlatform(snapshot: OracleCustomerSnapshot, organizationId: string): Promise<Record<string, unknown>> {
    const [platformCustomers, platformBalances] = await Promise.all([
      this.prisma.customer.findMany({
        where: { organizationId },
        select: { externalCustomerCode: true, name: true, status: true, accountNumber: true },
      }),
      this.prisma.customerBalance.findMany({
        where: { customer: { organizationId } },
        select: { currencyCode: true, customer: { select: { externalCustomerCode: true } } },
      }),
    ]);
    const oracleByCode = new Map(snapshot.customers.map((row) => [row.externalCustomerCode, row]));
    const platformByCode = new Map(platformCustomers.map((row) => [row.externalCustomerCode, row]));
    const matchedCodes = [...oracleByCode.keys()].filter((code) => platformByCode.has(code));
    const oracleOnly = [...oracleByCode.keys()].filter((code) => !platformByCode.has(code));
    const platformOnly = [...platformByCode.keys()].filter((code) => !oracleByCode.has(code));
    const nameDifferences = matchedCodes.filter((code) => oracleByCode.get(code)!.nameAr.trim() !== platformByCode.get(code)!.name.trim());
    const accountDifferences = matchedCodes.filter((code) => (oracleByCode.get(code)!.accountNumber ?? '') !== (platformByCode.get(code)!.accountNumber ?? ''));
    const statusDifferences = matchedCodes.filter((code) => {
      const expected = oracleByCode.get(code)!.isInactive ? 'inactive' : 'active';
      return platformByCode.get(code)!.status.toLowerCase() !== expected;
    });
    const oracleBalanceKeys = new Set(snapshot.customerBalances.map((row) => `${row.externalCustomerCode}|${row.currencyCode}`));
    const platformBalanceKeys = new Set(platformBalances.map((row) => `${row.customer.externalCustomerCode}|${row.currencyCode}`));
    const exactBalancePairs = [...oracleBalanceKeys].filter((key) => platformBalanceKeys.has(key)).length;
    const currencyCodes = (values: string[]) => [...new Set(values)].sort();
    return {
      oracleCustomers: snapshot.customers.length,
      platformCustomers: platformCustomers.length,
      matchedCustomers: matchedCodes.length,
      oracleOnlyCustomers: oracleOnly.length,
      platformOnlyCustomers: platformOnly.length,
      nameDifferences: nameDifferences.length,
      accountDifferences: accountDifferences.length,
      statusDifferences: statusDifferences.length,
      sampleCodes: { oracleOnly: oracleOnly.slice(0, 20), platformOnly: platformOnly.slice(0, 20), nameDifferences: nameDifferences.slice(0, 20), statusDifferences: statusDifferences.slice(0, 20) },
      oracleBalancePairs: oracleBalanceKeys.size,
      platformBalancePairs: platformBalanceKeys.size,
      exactCurrencyCodeBalancePairs: exactBalancePairs,
      oracleCurrencyCodes: currencyCodes(snapshot.customerBalances.map((row) => row.currencyCode)),
      platformCurrencyCodes: currencyCodes(platformBalances.map((row) => row.currencyCode)),
      note: 'Balance comparison is key-only until Oracle-to-platform currency mapping and local/foreign amount basis are approved.',
    };
  }

  private async insertBatches<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>): Promise<void> {
    for (let index = 0; index < rows.length; index += 500) await insert(rows.slice(index, index + 500));
  }

  private result(snapshot: OracleCustomerSnapshot, comparison: Record<string, unknown>, applied: boolean, syncRunId: string | null, status: OracleCustomerLoadResult['status']): OracleCustomerLoadResult {
    return { applied, syncRunId, sourceSchema: snapshot.sourceSchema, manifestHash: snapshot.manifestHash, counts: snapshot.sourceCounts, status, platformComparison: comparison };
  }
}
