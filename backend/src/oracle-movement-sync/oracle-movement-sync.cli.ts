import { PrismaService } from '../prisma/prisma.service';
import { OracleMovementSnapshotService } from './oracle-movement-snapshot.service';
import { OracleMovementSyncService } from './oracle-movement-sync.service';

function argument(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
async function main() {
  const snapshotDirectory = argument('--snapshot'); const organizationId = argument('--organization'); const triggeredBy = argument('--triggered-by'); const apply = process.argv.includes('--apply');
  if (!snapshotDirectory || !organizationId) throw new Error('Usage: oracle:movements:sync --snapshot <directory> --organization <uuid> [--apply]');
  const prisma = new PrismaService(); await prisma.onModuleInit();
  try { process.stdout.write(`${JSON.stringify(await new OracleMovementSyncService(prisma,new OracleMovementSnapshotService()).run({ snapshotDirectory, organizationId, triggeredBy, apply }),null,2)}\n`); }
  finally { await prisma.onModuleDestroy(); }
}
main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : 'Unknown movement sync error'}\n`); process.exitCode=1; });
