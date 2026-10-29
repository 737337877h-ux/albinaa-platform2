import { PrismaService } from '../prisma/prisma.service';
import { OracleInventoryPublicationService } from './oracle-inventory-publication.service';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const runId = argument('--run');
  const publish = process.argv.includes('--publish');
  const rollback = process.argv.includes('--rollback');
  const organizationId = argument('--organization');
  const sourceSchema = argument('--source') ?? 'IAS20261';
  if (publish && rollback) throw new Error('--publish and --rollback are mutually exclusive.');
  if (!rollback && !runId) {
    throw new Error('Usage: publication CLI --run <uuid> [--publish], or --rollback --organization <uuid> [--source IAS20261]');
  }
  if (rollback && !organizationId) throw new Error('--organization is required with --rollback.');

  const prisma = new PrismaService();
  await prisma.onModuleInit();
  try {
    const service = new OracleInventoryPublicationService(prisma);
    const result = rollback
      ? await service.rollbackToPrevious(organizationId!, sourceSchema)
      : publish
        ? await service.publish(runId!)
        : await service.validate(runId!);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await prisma.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown Oracle inventory publication error';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
