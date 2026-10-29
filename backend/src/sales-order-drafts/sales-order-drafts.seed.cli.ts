import { Prisma } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

interface SeedLine {
  LINE_NO: string;
  ITEM_CODE: string;
  ITEM_NAME?: string | null;
  UNIT_NAME: string;
  SOURCE_PACKAGE_SIZE: string;
  REQUESTED_QTY: string;
  SOURCE_WAREHOUSE?: string | null;
  AVAILABLE_QTY?: string | null;
  TOTAL_AVAILABLE_QTY: number | string;
  SOURCE_PRICE: string;
  LINE_READY: string;
  ISSUES?: string;
  ALTERNATIVE_WAREHOUSES?: string;
}

interface SeedDraft {
  SOURCE_ORDER_NO: string;
  SOURCE_ORDER_SER: string;
  SOURCE_DATE: string;
  SOURCE_CUSTOMER_CODE?: string | null;
  SOURCE_CUSTOMER_NAME?: string | null;
  SOURCE_CUSTOMER_MOBILE?: string | null;
  SOURCE_CUSTOMER_ADDRESS?: string | null;
  PROPOSED_CUSTOMER_CODE?: string | null;
  PROPOSED_CUSTOMER_NAME?: string | null;
  CURRENCY: string;
  SOURCE_HEADER_AMOUNT: string;
  READY_LINE_COUNT: number;
  ISSUES?: string;
  lines: SeedLine[];
}

interface SeedContract {
  contractVersion: string;
  mode: string;
  oracleWrite: string;
  platformTarget: string;
  generatedAt: string;
  drafts: SeedDraft[];
}

function alternatives(value?: string) {
  return (value ?? '').split(';').filter(Boolean).map((entry) => {
    const [warehouseCode, availableQuantity] = entry.split(':');
    return { warehouseCode, availableQuantity };
  });
}

async function main() {
  const seedPath = argument('--seed');
  const organizationId = argument('--organization');
  const createdBy = argument('--created-by');
  if (!seedPath || !organizationId || !createdBy) {
    throw new Error('Usage: seed CLI --seed <json> --organization <uuid> --created-by <uuid>');
  }
  const contract = JSON.parse(await readFile(seedPath, 'utf8')) as SeedContract;
  if (contract.contractVersion !== '1.0' || contract.mode !== 'platform-sales-order-draft-seed') {
    throw new Error('Unsupported sales-order draft seed contract');
  }
  if (contract.oracleWrite !== 'NONE' || contract.platformTarget !== '3004_TEST_ONLY') {
    throw new Error('Seed contract is not restricted to platform test drafts');
  }

  const prisma = new PrismaService();
  await prisma.onModuleInit();
  const audit = new AuditService(prisma);
  try {
    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    const user = await prisma.user.findFirst({ where: { id: createdBy, organizationId }, select: { id: true } });
    if (!organization || !user) throw new Error('Organization or creating user does not exist');

    const results: Array<{ id: string; sourceOrderNo: string; lines: number }> = [];
    for (const draft of contract.drafts) {
      const lineData = draft.lines.map((line) => {
        const choices = alternatives(line.ALTERNATIVE_WAREHOUSES);
        const issues = (line.ISSUES ?? '').split(';').filter(Boolean);
        const reassignment = issues.includes('SOURCE_WAREHOUSE_REASSIGN_REQUIRED');
        return {
          lineNo: Number(line.LINE_NO), itemCode: line.ITEM_CODE, itemName: line.ITEM_NAME ?? null,
          unitCode: line.UNIT_NAME, packageSize: new Prisma.Decimal(line.SOURCE_PACKAGE_SIZE),
          quantity: new Prisma.Decimal(line.REQUESTED_QTY), sourcePrice: new Prisma.Decimal(line.SOURCE_PRICE),
          sourceWarehouseCode: line.SOURCE_WAREHOUSE || null,
          proposedWarehouseCode: reassignment ? choices[0]?.warehouseCode ?? null : line.SOURCE_WAREHOUSE || null,
          originalAvailableQty: line.AVAILABLE_QTY ? new Prisma.Decimal(line.AVAILABLE_QTY) : null,
          totalAvailableQty: new Prisma.Decimal(String(line.TOTAL_AVAILABLE_QTY)),
          validationStatus: line.LINE_READY === 'YES' ? 'ready' : reassignment ? 'warehouse_review' : 'blocked',
          issues, alternativeWarehouses: choices,
        };
      });
      const issueCodes = (draft.ISSUES ?? '').split(';').filter(Boolean);
      const saved = await prisma.$transaction(async (tx) => {
        const db = tx as any;
        const current = await db.salesOrderDraft.findUnique({
          where: { organizationId_sourceSchema_sourceOrderSerial: {
            organizationId, sourceSchema: 'IAS20251', sourceOrderSerial: draft.SOURCE_ORDER_SER,
          } }, select: { id: true },
        });
        if (current) {
          await db.salesOrderDraftLine.deleteMany({ where: { draftId: current.id } });
          return db.salesOrderDraft.update({
            where: { id: current.id }, data: {
              sourceOrderNo: draft.SOURCE_ORDER_NO, sourceOrderDate: new Date(`${draft.SOURCE_DATE}T00:00:00Z`),
              sourceCustomerCode: draft.SOURCE_CUSTOMER_CODE ?? null, sourceCustomerName: draft.SOURCE_CUSTOMER_NAME ?? null,
              sourceCustomerMobile: draft.SOURCE_CUSTOMER_MOBILE ?? null, sourceCustomerAddress: draft.SOURCE_CUSTOMER_ADDRESS ?? null,
              proposedCustomerCode: draft.PROPOSED_CUSTOMER_CODE ?? null, proposedCustomerName: draft.PROPOSED_CUSTOMER_NAME ?? null,
              currencyCode: draft.CURRENCY, sourceAmount: new Prisma.Decimal(draft.SOURCE_HEADER_AMOUNT),
              validationStatus: 'blocked', validationSummary: {
                capturedAt: contract.generatedAt, issueCodes, totalLines: draft.lines.length,
                readyLines: draft.READY_LINE_COUNT, oracleWrite: 'NONE', platformTarget: '3004_TEST_ONLY',
              }, oracleWriteEnabled: false, lines: { create: lineData },
            }, include: { lines: true },
          });
        }
        return db.salesOrderDraft.create({
          data: {
            organizationId, sourceSchema: 'IAS20251', sourceOrderNo: draft.SOURCE_ORDER_NO,
            sourceOrderSerial: draft.SOURCE_ORDER_SER, sourceOrderDate: new Date(`${draft.SOURCE_DATE}T00:00:00Z`),
            sourceCustomerCode: draft.SOURCE_CUSTOMER_CODE ?? null, sourceCustomerName: draft.SOURCE_CUSTOMER_NAME ?? null,
            sourceCustomerMobile: draft.SOURCE_CUSTOMER_MOBILE ?? null, sourceCustomerAddress: draft.SOURCE_CUSTOMER_ADDRESS ?? null,
            proposedCustomerCode: draft.PROPOSED_CUSTOMER_CODE ?? null, proposedCustomerName: draft.PROPOSED_CUSTOMER_NAME ?? null,
            currencyCode: draft.CURRENCY, sourceAmount: new Prisma.Decimal(draft.SOURCE_HEADER_AMOUNT),
            validationStatus: 'blocked', validationSummary: {
              capturedAt: contract.generatedAt, issueCodes, totalLines: draft.lines.length,
              readyLines: draft.READY_LINE_COUNT, oracleWrite: 'NONE', platformTarget: '3004_TEST_ONLY',
            }, notes: 'مسودة مراجعة من طلب تاريخي؛ لا يوجد نشر أو كتابة إلى Oracle.',
            oracleWriteEnabled: false, createdBy, lines: { create: lineData },
          }, include: { lines: true },
        });
      });
      await audit.log({
        userId: createdBy, action: 'sales_order_draft_seeded', entityTable: 'sales_order_drafts', entityId: saved.id,
        newValue: { sourceSchema: 'IAS20251', sourceOrderSerial: draft.SOURCE_ORDER_SER, status: 'draft_review', oracleWrite: 'NONE' },
        reason: 'User-approved creation in isolated 3004 platform only.',
      });
      results.push({ id: saved.id, sourceOrderNo: draft.SOURCE_ORDER_NO, lines: saved.lines.length });
    }
    process.stdout.write(`${JSON.stringify({ success: true, oracleWrite: 'NONE', platformTarget: '3004_TEST_ONLY', drafts: results }, null, 2)}\n`);
  } finally {
    await prisma.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
