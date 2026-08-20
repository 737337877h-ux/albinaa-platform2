import { PrismaService } from '../prisma/prisma.service';
import { OracleCustomerSnapshotService } from './oracle-customer-snapshot.service';
import { OracleCustomerSyncService } from './oracle-customer-sync.service';

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }

async function main(): Promise<void> {
  const snapshotDirectory = argument('--snapshot');
  const organizationId = argument('--organization');
  const triggeredBy = argument('--triggered-by');
  const apply = process.argv.includes('--apply');
  if (!snapshotDirectory || !organizationId) throw new Error('Usage: npm run oracle:customers:sync -- --snapshot <directory> --organization <uuid> [--triggered-by <uuid>] [--apply]');
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  try {
    const service = new OracleCustomerSyncService(prisma, new OracleCustomerSnapshotService());
    const result = await service.run({ snapshotDirectory, organizationId, triggeredBy, apply });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally { await prisma.onModuleDestroy(); }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unknown Oracle customer synchronization error'}\n`);
  process.exitCode = 1;
});
