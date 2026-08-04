import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { Response as SuperAgentResponse } from 'superagent';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { username: 'admin', password: process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe!2026' };
const binaryParser = (response: SuperAgentResponse, callback: (error: Error | null, body?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', (error: Error) => callback(error));
};

describe('Management report and customer statement exports (e2e)', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string; let customerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    token = (await request(app.getHttpServer()).post('/auth/login').send(ADMIN).expect(200)).body.accessToken;
    const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' } });
    const customer = await prisma.customer.create({ data: {
      organizationId: admin.organizationId, externalCustomerCode: 'REPORT-EXPORT-1',
      name: 'عميل اختبار التقارير', nameNormalized: 'عميل اختبار التقارير',
    } });
    customerId = customer.id;
    const documentType = await prisma.documentType.findFirstOrThrow({ where: { organizationId: admin.organizationId } });
    const job = await prisma.importJob.create({ data: {
      organizationId: admin.organizationId, fileName: 'report-export.xlsx',
      fileHash: `report-export-${Date.now()}`, uploadedBy: admin.id,
    } });
    await prisma.customerBalance.create({ data: {
      customerId, currencyCode: 'YER', accountingBalance: 1500, openingDebit: 1000,
      lastImportJobId: job.id,
    } });
    await prisma.importedTransaction.create({ data: {
      customerId, currencyCode: 'YER', documentTypeId: documentType.id,
      txDate: new Date('2026-08-01'), debit: 500, credit: 0,
      documentNumber: 'INV-500', description: 'فاتورة اختبار',
      lineHash: `report-line-${Date.now()}`, importJobId: job.id,
    } });
  });

  afterAll(async () => { if (app) await app.close(); });

  it('returns a currency-separated management summary and formatted Excel workbook', async () => {
    const summary = await request(app.getHttpServer()).get('/reports/summary')
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(summary.body.currenciesSeparated).toBe(true);
    expect(summary.body.byCurrency.find((row: any) => row.currency === 'YER').debtTotal).toBeGreaterThanOrEqual(1500);

    const response = await request(app.getHttpServer()).get('/reports/summary.xlsx')
      .set('Authorization', `Bearer ${token}`).buffer(true).parse(binaryParser).expect(200);
    expect(response.headers['content-type']).toContain('spreadsheetml');
    expect(Buffer.from(response.body).subarray(0, 2).toString()).toBe('PK');
    const workbook = new ExcelJS.Workbook();
    const excelBuffer = Buffer.from(response.body) as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(excelBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(expect.arrayContaining(['الملخص', 'أعلى المدينين', 'أعمار الديون']));
    expect(workbook.getWorksheet('الملخص')?.views[0]).toMatchObject({ state: 'frozen', ySplit: 1, rightToLeft: true });
    expect(workbook.getWorksheet('الملخص')?.getCell('A1').fill).toMatchObject({ type: 'pattern', fgColor: { argb: 'FF0F4C3A' } });
  });

  it('creates a real Arabic PDF customer statement', async () => {
    const response = await request(app.getHttpServer()).get(`/customers/${customerId}/statement.pdf?currency=YER`)
      .set('Authorization', `Bearer ${token}`).buffer(true).parse(binaryParser).expect(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    const pdf = Buffer.from(response.body);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(5000);
  });
});
