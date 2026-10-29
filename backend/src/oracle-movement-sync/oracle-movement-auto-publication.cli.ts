import { PrismaService } from '../prisma/prisma.service';
import { OracleMovementAutoPublicationService } from './oracle-movement-auto-publication.service';

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const organizationId = argument('--organization');
  const sourceSchema = argument('--source') ?? 'IAS20261';
  const actor = argument('--published-by') ?? argument('--triggered-by');
  const apply = process.argv.includes('--apply');
  if (!organizationId || !actor) {
    throw new Error('Usage: oracle:movements:publication --organization <uuid> --published-by <uuid> [--apply]');
  }
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  const service = new OracleMovementAutoPublicationService(prisma);
  try {
    let result: unknown;
    if (process.argv.includes('--initialize-baseline')) {
      const minimumMovementDate = argument('--minimum-date');
      if (!minimumMovementDate) throw new Error('--minimum-date is required for baseline initialization.');
      result = await service.initializeBaseline({ organizationId, sourceSchema, triggeredBy: actor, minimumMovementDate, apply });
    } else if (process.argv.includes('--enable')) {
      result = await service.configure({ organizationId, triggeredBy: actor, enabled: true, apply });
    } else if (process.argv.includes('--disable')) {
      result = await service.configure({ organizationId, triggeredBy: actor, enabled: false, apply });
    } else if (argument('--rollback-batch')) {
      result = await service.rollback({ organizationId, batchId: argument('--rollback-batch')!, reversedBy: actor, apply });
    } else {
      result = await service.publish({ organizationId, sourceSchema, publishedBy: actor, apply });
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await prisma.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unknown automatic movement publication error'}\n`);
  process.exitCode = 1;
});
