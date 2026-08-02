import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticalAccountsService } from './analytical-accounts.service';

/**
 * In-memory fakes for Prisma/Audit \u2014 this repo has no existing pattern for
 * mocking PrismaService (see risk.service.spec.ts / tasks.service.spec.ts,
 * which only test pure functions), so importCsv is exercised end-to-end
 * against a minimal fake implementing just the calls it makes. Kept entirely
 * separate from Customer/CustomerBalance/Collection/Reservation models \u2014
 * none of those are referenced here or by the service under test.
 */
class FakePrisma {
  currencies = [{ code: 'YER' }, { code: 'USD' }];
  accounts: any[] = [];
  movements: any[] = [];
  importJobs: any[] = [];
  private nextId = 1;

  currency = {
    findMany: async () => this.currencies,
  };

  importJob = {
    create: async ({ data }: any) => {
      const job = { id: `job-${this.nextId++}`, ...data };
      this.importJobs.push(job);
      return job;
    },
    update: async ({ where, data }: any) => {
      const job = this.importJobs.find((j) => j.id === where.id);
      Object.assign(job, data);
      return job;
    },
  };

  analyticalAccount = {
    findUnique: async ({ where }: any) => {
      const k = where.organizationId_accountNumber_currencyCode;
      return (
        this.accounts.find(
          (a) =>
            a.organizationId === k.organizationId
            && a.accountNumber === k.accountNumber
            && a.currencyCode === k.currencyCode,
        ) ?? null
      );
    },
    create: async ({ data }: any) => {
      const account = { id: `acc-${this.nextId++}`, ...data };
      this.accounts.push(account);
      return account;
    },
    update: async ({ where, data }: any) => {
      const k = where.organizationId_accountNumber_currencyCode;
      const account = this.accounts.find(
        (a) =>
          a.organizationId === k.organizationId
          && a.accountNumber === k.accountNumber
          && a.currencyCode === k.currencyCode,
      );
      Object.assign(account, data);
      return account;
    },
  };

  analyticalMovement = {
    findUnique: async ({ where }: any) =>
      this.movements.find((m) => m.lineHash === where.lineHash) ?? null,
    create: async ({ data }: any) => {
      const movement = { id: `mov-${this.nextId++}`, ...data };
      this.movements.push(movement);
      return movement;
    },
  };
}

class FakeAudit {
  logs: any[] = [];
  async log(entry: any) {
    this.logs.push(entry);
  }
}

function makeService() {
  const prisma = new FakePrisma();
  const audit = new FakeAudit();
  const service = new AnalyticalAccountsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, prisma, audit };
}

const actor: AuthUser = {
  id: 'user-1',
  organizationId: 'org-1',
  branchId: null,
  username: 'tester',
  fullName: 'Test User',
  roles: [],
  permissions: [],
};

function csvBuffer(lines: string[]): Buffer {
  return Buffer.from(lines.join('\r\n'), 'utf-8');
}

function makeFile(buffer: Buffer, originalname = 'import.csv'): Express.Multer.File {
  return { buffer, originalname } as Express.Multer.File;
}

const EMPLOYEE_HEADER =
  'employeeNumber,employeeName,accountNumber,currencyCode,date,docType,docNo,description,debit,credit';
const DEBTOR_HEADER =
  'accountNumber,accountName,currencyCode,date,docType,docNo,description,debit,credit';

describe('AnalyticalAccountsService.importCsv (PR-7 employee category fix)', () => {
  it('employee advance import: creates the account as employee_advance and inserts the movement', async () => {
    const { service, prisma } = makeService();
    const file = makeFile(
      csvBuffer([EMPLOYEE_HEADER, 'E1,Ahmad,ACC-1,YER,2026-01-01,,,Advance,100,0']),
    );

    const result = await service.importCsv(actor, 'employee', 'employee_advance', file);

    expect(result.errors).toEqual([]);
    expect(result.accountsCreated).toBe(1);
    expect(result.movementsInserted).toBe(1);
    expect(prisma.accounts[0].category).toBe('employee_advance');
  });

  it('employee custody import: creates the account as employee_custody and inserts the movement', async () => {
    const { service, prisma } = makeService();
    const file = makeFile(
      csvBuffer([EMPLOYEE_HEADER, 'E2,Sara,ACC-2,YER,2026-01-01,,,Custody,80,0']),
    );

    const result = await service.importCsv(actor, 'employee', 'employee_custody', file);

    expect(result.errors).toEqual([]);
    expect(result.accountsCreated).toBe(1);
    expect(result.movementsInserted).toBe(1);
    expect(prisma.accounts[0].category).toBe('employee_custody');
  });

  it('rejects an employee import missing employeeCategory, creating no account or movement', async () => {
    const { service, prisma } = makeService();
    const file = makeFile(
      csvBuffer([EMPLOYEE_HEADER, 'E3,Mona,ACC-3,YER,2026-01-01,,,Advance,50,0']),
    );

    await expect(service.importCsv(actor, 'employee', undefined, file)).rejects.toThrow(
      /employeeCategory is required/,
    );
    expect(prisma.accounts).toHaveLength(0);
    expect(prisma.movements).toHaveLength(0);
  });

  it('existing-account conflict: employee_advance account cannot be silently recategorized to employee_custody', async () => {
    const { service, prisma } = makeService();
    const first = makeFile(
      csvBuffer([EMPLOYEE_HEADER, 'E4,Yousef,ACC-4,YER,2026-01-01,,,First advance,100,0']),
    );
    await service.importCsv(actor, 'employee', 'employee_advance', first);
    expect(prisma.accounts[0].category).toBe('employee_advance');

    const conflicting = makeFile(
      csvBuffer([EMPLOYEE_HEADER, 'E4,Yousef,ACC-4,YER,2026-01-02,,,Custody attempt,50,0']),
    );
    const result = await service.importCsv(actor, 'employee', 'employee_custody', conflicting);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('employee_advance');
    expect(result.errors[0].message).toContain('employee_custody');
    expect(result.accountsUpdated).toBe(0);
    expect(result.movementsInserted).toBe(0);
    expect(prisma.accounts).toHaveLength(1);
    expect(prisma.accounts[0].category).toBe('employee_advance');
    expect(prisma.movements).toHaveLength(1);
  });

  it('debtor conflict: a debtor-layout row cannot silently update an account holding a non-debtor category', async () => {
    const { service, prisma } = makeService();
    await service.importCsv(
      actor,
      'employee',
      'employee_advance',
      makeFile(csvBuffer([EMPLOYEE_HEADER, 'E5,Khalid,ACC-5,YER,2026-01-01,,,Advance,100,0'])),
    );
    expect(prisma.accounts[0].category).toBe('employee_advance');

    const result = await service.importCsv(
      actor,
      'debtor',
      undefined,
      makeFile(csvBuffer([DEBTOR_HEADER, 'ACC-5,Some Debtor,YER,2026-01-02,,,Debtor attempt,75,0'])),
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('employee_advance');
    expect(result.errors[0].message).toContain('debtor');
    expect(result.movementsInserted).toBe(0);
    expect(prisma.accounts).toHaveLength(1);
    expect(prisma.accounts[0].category).toBe('employee_advance');
  });

  it('CSV handling: quoted commas, embedded newlines, and escaped quotes parse correctly', async () => {
    const { service, prisma } = makeService();
    const quotedRow =
      'ACC-6,"Debtor, With Comma",YER,2026-01-01,,,"Line one\nLine two with ""quotes""",120,0';
    const file = makeFile(Buffer.from([DEBTOR_HEADER, quotedRow].join('\r\n'), 'utf-8'));

    const result = await service.importCsv(actor, 'debtor', undefined, file);

    expect(result.errors).toEqual([]);
    expect(result.accountsCreated).toBe(1);
    expect(result.movementsInserted).toBe(1);
    expect(prisma.accounts[0].accountName).toBe('Debtor, With Comma');
    expect(prisma.movements[0].description).toBe('Line one\nLine two with "quotes"');
  });

  it('amount validation: empty debit/credit becomes zero; invalid text, NaN, and Infinity produce row-level errors', async () => {
    const { service, prisma } = makeService();
    const file = makeFile(
      csvBuffer([
        DEBTOR_HEADER,
        'ACC-7,Debtor Seven,YER,2026-01-01,,,Empty amounts,,',
        'ACC-8,Debtor Eight,YER,2026-01-01,,,Bad text,abc,0',
        'ACC-9,Debtor Nine,YER,2026-01-01,,,NaN value,NaN,0',
        'ACC-10,Debtor Ten,YER,2026-01-01,,,Infinity value,Infinity,0',
      ]),
    );

    const result = await service.importCsv(actor, 'debtor', undefined, file);

    expect(result.accountsCreated).toBe(1);
    expect(result.movementsInserted).toBe(1);
    expect(prisma.movements[0].debit).toBe(0);
    expect(prisma.movements[0].credit).toBe(0);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.map((e) => e.rowNumber)).toEqual([3, 4, 5]);
    for (const err of result.errors) {
      expect(err.message).toMatch(/Invalid debit value/);
    }
  });

  it('duplicate re-import: the same movement is skipped via lineHash and not inserted twice', async () => {
    const { service, prisma } = makeService();
    const row = 'ACC-11,Debtor Eleven,YER,2026-01-01,INV,1001,First import,200,0';

    const first = await service.importCsv(
      actor,
      'debtor',
      undefined,
      makeFile(csvBuffer([DEBTOR_HEADER, row])),
    );
    expect(first.movementsInserted).toBe(1);
    expect(first.movementsSkippedDuplicate).toBe(0);
    expect(first.accountsCreated).toBe(1);

    const second = await service.importCsv(
      actor,
      'debtor',
      undefined,
      makeFile(csvBuffer([DEBTOR_HEADER, row])),
    );
    expect(second.movementsInserted).toBe(0);
    expect(second.movementsSkippedDuplicate).toBe(1);
    expect(second.accountsUpdated).toBe(1);
    expect(prisma.movements).toHaveLength(1);
  });
});
