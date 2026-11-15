import {oracleReceiptActivity} from '../common/oracle-receipt-activity';
import {performanceRange,collectorPerformance,periodTarget} from './collector-performance';
import {Prisma} from '@prisma/client';
import {FINANCIAL_COLLECTION_STATUSES} from '../common/financial-collection-status';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { calculateCei, calculateDso, safePercent, weightedDebtAge } from './kpi-calculator';
import { UpdateCollectorTargetDto } from './dto/update-collector-target.dto';
import ExcelJS from 'exceljs';
import { AgingService } from '../aging/aging.service';
import { renderManagementSummaryPdf } from './summary-pdf.renderer';

const key = (a: string, b: string) => `${a}|${b}`;
const monthKey = (date: Date) => date.toISOString().slice(0, 7);
const monthStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const nextMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly aging: AgingService,
  ) {}

  async collectorPerformance(actor:AuthUser,from:string,to:string){
    const collectedAt=performanceRange(from,to);
    const roles=actor.roles??[],collectorOnly=roles.includes('المحصل')&&!roles.some(r=>['مدير النظام','مدير المديونية','المحاسب'].includes(r));
    const team=actor.permissions.includes('customers.read_all')&&!collectorOnly;
    const collectorScope={user:{organizationId:actor.organizationId},...(!team?{userId:actor.id}:{})};
    const collectors=await this.prisma.collector.findMany({where:collectorScope,orderBy:[{oracleCollectorNo:'asc'},{user:{fullName:'asc'}}],select:{id:true,userId:true,oracleCollectorNo:true,active:true,user:{select:{fullName:true}}}});
    const ids=collectors.map(c=>c.id),userIds=collectors.map(c=>c.userId);
    const rows=await this.prisma.collection.findMany({where:{customer:{organizationId:actor.organizationId},collector:collectorScope,status:{in:FINANCIAL_COLLECTION_STATUSES},collectedAt},select:{id:true,collectorId:true,customerId:true,currencyCode:true,amount:true,status:true,collector:{select:{user:{select:{fullName:true}}}}}});
    const scopedActor=team?actor:{...actor,permissions:actor.permissions.filter(p=>p!=='customers.read_all')};
    const oracleRows=(await oracleReceiptActivity(this.prisma,scopedActor,undefined,{includeInactiveCollectors:true})).filter(row=>{const date=new Date(row.collectedAt);return ids.includes(row.collector.id)&&date>=collectedAt.gte&&date<collectedAt.lt;}).map(row=>({...row,collectorId:row.collector.id}));
    const dateRange={gte:new Date(from+'T00:00:00Z'),lte:new Date(to+'T00:00:00Z')};
    // Sequential reads avoid exhausting the small production connection pool.
    const followups=await this.prisma.followup.findMany({where:{customer:{organizationId:actor.organizationId},user:{organizationId:actor.organizationId},userId:{in:userIds},deletedAt:null,followupAt:collectedAt},select:{userId:true,customerId:true}});
    const promises=await this.prisma.paymentPromise.findMany({where:{customer:{organizationId:actor.organizationId},collectorId:{in:ids},OR:[{promiseDate:dateRange},{dueDate:dateRange}]},select:{collectorId:true,currencyCode:true,promiseDate:true,dueDate:true,status:true}});
    const targets=await this.prisma.collectorTarget.findMany({where:{collectorId:{in:ids},month:{gte:new Date(from.slice(0,7)+'-01T00:00:00Z'),lte:dateRange.lte}},select:{collectorId:true,currencyCode:true,month:true,targetAmount:true}});
    const assignments=await this.prisma.customerAssignment.findMany({where:{collectorId:{in:ids},effectiveTo:null,customer:{organizationId:actor.organizationId,status:'active',mergedIntoId:null}},select:{collectorId:true,customerId:true}});
    const snapshot=await this.prisma.oracleMovementSyncRun.findFirst({where:{organizationId:actor.organizationId,sourceSchema:'IAS20261',status:'published'},orderBy:{startedAt:'desc'},select:{startedAt:true}});
    const report=collectorPerformance([...rows,...oracleRows]);
    const currencies=[...new Set([...report.totals.map(t=>t.currency),...promises.map(p=>p.currencyCode),...targets.map(t=>t.currencyCode)])].sort();
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Aden',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const inRange=(date:Date)=>date>=dateRange.gte&&date<=dateRange.lte;
    const activity=collectors.map(c=>{
      const calls=followups.filter(f=>f.userId===c.userId),due=promises.filter(p=>p.collectorId===c.id&&inRange(p.dueDate)&&p.status!=='cancelled_approved');
      return {collectorId:c.id,collectorName:c.user.fullName,collectorNo:c.oracleCollectorNo,active:c.active,followups:calls.length,followedCustomers:new Set(calls.map(f=>f.customerId)).size,assignedCustomers:new Set(assignments.filter(a=>a.collectorId===c.id).map(a=>a.customerId)).size,promisesCreated:promises.filter(p=>p.collectorId===c.id&&inRange(p.promiseDate)).length,promisesDue:due.length,promisesFulfilled:due.filter(p=>p.status==='fulfilled').length,promisesOverdue:due.filter(p=>p.dueDate.toISOString().slice(0,10)<today&&!['fulfilled','cancelled_approved','closed_settled'].includes(p.status)).length};
    });
    const financial=collectors.flatMap(c=>currencies.map(currency=>{
      const amount=report.rows.find(r=>r.collectorId===c.id&&r.currency===currency),target=periodTarget(targets.filter(t=>t.collectorId===c.id&&t.currencyCode===currency),from,to);
      return {collectorId:c.id,collectorName:c.user.fullName,collectorNo:c.oracleCollectorNo,currency,amount:amount?.amount??'0.0000',receipts:amount?.receipts??0,customers:amount?.customers??0,sharePercent:team?(amount?.sharePercent??(report.totals.some(t=>t.currency===currency)?'0.00':null)):null,target,targetAttainment:target&&new Prisma.Decimal(target).gt(0)?new Prisma.Decimal(amount?.amount??0).div(target).mul(100).toFixed(2):null};
    }));
    return {from,to,timeZone:'Asia/Aden',generatedAt:new Date(),scope:team?'team':'self',oracleSnapshotAt:snapshot?.startedAt??null,sources:{platform:rows.length,oracleMirror:oracleRows.length},targetBasis:'proportional_calendar_days',totals:report.totals,rows:financial,activity};
  }

  async collectorPerformanceWorkbook(actor:AuthUser,from:string,to:string){
    const report=await this.collectorPerformance(actor,from,to),book=new ExcelJS.Workbook();
    const make=(name:string,headers:string[])=>{
      const sheet=book.addWorksheet(name,{views:[{rightToLeft:true,state:'frozen',ySplit:1}]});
      sheet.columns=headers.map((header,i)=>({header,width:i===1?34:23,style:{numFmt:'@',font:{name:'Arial',size:11},alignment:{horizontal:'right',readingOrder:'rtl',wrapText:true}}}));
      sheet.getRow(1).font={name:'Arial',bold:true,color:{argb:'FFFFFFFF'}};
      sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF004B40'}};return sheet;
    };
    const meta=make('الفترة والمصادر',['البيان','القيمة']);
    meta.addRows([['من',from],['إلى',to],['التوقيت','عدن'],['النطاق',report.scope==='team'?'المحصلون ضمن صلاحياتك':'المحصل الحالي فقط'],['لقطة Oracle',report.oracleSnapshotAt?.toISOString()??'غير متاحة'],['تحصيلات المنصة المعتمدة',String(report.sources.platform)],['سندات Oracle الإضافية',String(report.sources.oracleMirror)],['الاحتساب','طلبات القبض غير المرحلة مستبعدة؛ لا تُجمع العملات'],['الهدف','هدف شهري موزع بنسبة أيام الفترة التقويمية؛ الهدف الناقص غير متاح'],['الوعود','الحالة الحالية للوعود ذات مواعيد استحقاق ضمن الفترة']]);
    for(const total of report.totals)meta.addRow(['الإجمالي '+total.currency,total.amount]);
    const money=make('التحصيل والأهداف',['رقم المحصل','المحصل','العملة','التحصيل','السندات','العملاء','المساهمة %','الهدف النسبي للفترة','الإنجاز %']);
    for(const r of report.rows)money.addRow([String(r.collectorNo??''),r.collectorName,r.currency,r.amount,String(r.receipts),String(r.customers),r.sharePercent??'',r.target??'',r.targetAttainment??'']);
    const work=make('المتابعات والوعود',['رقم المحصل','المحصل','المتابعات','العملاء المتابَعون','المسندون حاليًا','الوعود المنشأة','وعود تستحق بالفترة','الوعود المنفذة','الوعود المتأخرة']);
    for(const r of report.activity)work.addRow([String(r.collectorNo??''),r.collectorName,...[r.followups,r.followedCustomers,r.assignedCustomers,r.promisesCreated,r.promisesDue,r.promisesFulfilled,r.promisesOverdue].map(String)]);
    for(const sheet of [money,work])sheet.autoFilter={from:{row:1,column:1},to:{row:sheet.rowCount,column:9}};
    return Buffer.from(await book.xlsx.writeBuffer());
  }

  async summary(actor: AuthUser, accountClass: 'customer' | 'advance' = 'customer') {
    const accountFilter = accountClass === 'advance'
      ? { customerType: 'advance' }
      : { OR: [{ customerType: null }, { customerType: { not: 'advance' } }] };
    const reservations = await this.prisma.reservation.findMany({
        where: { customer: { organizationId: actor.organizationId, ...accountFilter }, status: { in: ['open', 'partial'] } },
        include: { customer: { select: { name: true } } },
      });
    // Aging and KPI each fan out into several queries. Keep them sequential so
    // a small production connection pool is not exhausted by one report request.
    const aging = await this.aging.report(actor, { accountClass });
    const kpi = await this.kpi(actor, accountClass);
    const operationalBalances = aging.customers.map((row) => ({
      customerId: String(row.customerId), currencyCode: row.currency,
      accountingBalance: row.totalDue,
      customer: { externalCustomerCode: String(row.customerCode ?? ''), name: String(row.customerName ?? '') },
    }));
    const currencies = [...new Set([
      ...operationalBalances.map((row) => row.currencyCode),
      ...reservations.map((row) => row.currencyCode),
      ...Object.keys(aging.totals),
      ...Object.keys(kpi.latestByCurrency),
    ])].sort();
    const byCurrency = currencies.map((currency) => {
      const currencyBalances = operationalBalances.filter((row) => row.currencyCode === currency);
      const currencyReservations = reservations.filter((row) => row.currencyCode === currency);
      return {
        currency,
        debtTotal: currencyBalances.reduce((sum, row) => sum + Number(row.accountingBalance), 0),
        debtorCount: currencyBalances.length,
        reservationTotal: currencyReservations.reduce((sum, row) => sum + Number(row.totalAmount ?? 0), 0),
        reservationCount: currencyReservations.length,
        aging: aging.totals[currency] ?? null,
        kpi: kpi.latestByCurrency[currency] ?? null,
      };
    });
    const topDebtors = currencies.flatMap((currency) => operationalBalances
      .filter((row) => row.currencyCode === currency)
      .sort((a, b) => Number(b.accountingBalance) - Number(a.accountingBalance))
      .slice(0, 10)
      .map((row, index) => ({
        rank: index + 1, currency, customerId: row.customerId, customerCode: row.customer.externalCustomerCode,
        customerName: row.customer.name, balance: Number(row.accountingBalance),
      })));
    const activeReservations = reservations.map((row) => ({
      id: row.id, customerName: row.customer.name, currency: row.currencyCode,
      itemName: row.itemName ?? '—', totalAmount: Number(row.totalAmount ?? 0),
      status: row.status, expiresAt: row.expiresAt,
    }));
    return {
      generatedAt: new Date(), accountClass, currenciesSeparated: true, byCurrency, topDebtors, activeReservations,
      collectorPerformance: kpi.collectors,
      aging: { asOf: aging.asOf, snapshot: aging.snapshot, totals: aging.totals },
    };
  }

  private styleSheet(sheet: ExcelJS.Worksheet) {
    sheet.views = [{ state: 'frozen', ySplit: 1, rightToLeft: true }];
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C3A' } };
    header.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.eachRow((row) => { row.alignment = { vertical: 'middle', readingOrder: 'rtl' }; });
    sheet.columns.forEach((column) => {
      let width = 12;
      column.eachCell?.({ includeEmpty: true }, (cell) => { width = Math.max(width, String(cell.value ?? '').length + 2); });
      column.width = Math.min(40, width);
    });
    sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(sheet.columnCount).letter}1` };
  }

  async summaryWorkbook(actor: AuthUser, accountClass: 'customer' | 'advance' = 'customer') {
    const report = await this.summary(actor, accountClass);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'منصة البناء الراقي'; workbook.created = new Date();
    const overview = workbook.addWorksheet('الملخص');
    overview.addRow(['العملة', 'إجمالي المديونية', 'عدد المدينين', 'قيمة الحجوزات', 'عدد الحجوزات', 'DSO', 'CEI', 'متوسط عمر الدين']);
    report.byCurrency.forEach((row) => overview.addRow([
      row.currency, row.debtTotal, row.debtorCount, row.reservationTotal, row.reservationCount,
      row.kpi?.dso ?? null, row.kpi?.cei ?? null, row.kpi?.averageDebtAge ?? null,
    ]));
    const debtors = workbook.addWorksheet('أعلى المدينين');
    debtors.addRow(['الترتيب', 'العملة', 'كود العميل', 'اسم العميل', 'الرصيد']);
    report.topDebtors.forEach((row) => debtors.addRow([row.rank, row.currency, row.customerCode, row.customerName, row.balance]));
    const collectors = workbook.addWorksheet('أداء المحصلين');
    collectors.addRow(['المحصل', 'العملة', 'تحصيل اليوم', 'تحصيل الشهر', 'الهدف', 'نسبة الإنجاز', 'نسبة الوفاء بالوعود']);
    report.collectorPerformance.forEach((row) => collectors.addRow([
      row.collectorName, row.currency, row.dailyAmount, row.monthlyAmount, row.target,
      row.attainment, row.promiseRate,
    ]));
    const aging = workbook.addWorksheet('أعمار الديون');
    aging.addRow(['العملة', '0-30', '31-60', '61-90', '91-120', '+120', 'غير مؤرخ', 'الإجمالي', 'المخصص']);
    Object.entries(report.aging.totals).forEach(([currency, row]) => aging.addRow([
      currency, row.bucket_0_30, row.bucket_31_60, row.bucket_61_90, row.bucket_91_120,
      row.bucket_120_plus, row.undated, row.totalDue, row.provisionAmount,
    ]));
    const reservations = workbook.addWorksheet('الحجوزات');
    reservations.addRow(['العميل', 'الصنف', 'العملة', 'القيمة', 'الحالة', 'الانتهاء']);
    report.activeReservations.forEach((row) => reservations.addRow([
      row.customerName, row.itemName, row.currency, row.totalAmount, row.status,
      row.expiresAt ? row.expiresAt.toISOString().slice(0, 10) : '',
    ]));
    workbook.worksheets.forEach((sheet) => this.styleSheet(sheet));
    for (const sheet of workbook.worksheets) {
      for (let column = 2; column <= sheet.columnCount; column += 1) sheet.getColumn(column).numFmt = '#,##0.00';
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async summaryPdf(actor: AuthUser, accountClass: 'customer' | 'advance' = 'customer') {
    const report = await this.summary(actor, accountClass);
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: { name: true, systemSettings: { select: { key: true, value: true } } },
    });
    return renderManagementSummaryPdf(report, organization, actor.fullName || actor.username);
  }

  async updateTarget(actor: AuthUser, collectorId: string, currencyCode: string, dto: UpdateCollectorTargetDto, req?: Request) {
    const collector = await this.prisma.collector.findFirst({ where: { id: collectorId, user: { organizationId: actor.organizationId } } });
    if (!collector) throw new NotFoundException('المحصل غير موجود ضمن المنشأة');
    if (!await this.prisma.currency.findFirst({ where: { code: currencyCode, active: true } })) throw new BadRequestException('العملة غير معروفة أو معطلة');
    const month = monthStart(new Date(dto.month));
    const before = await this.prisma.collectorTarget.findUnique({ where: { collectorId_currencyCode_month: { collectorId, currencyCode, month } } });
    const target = await this.prisma.collectorTarget.upsert({
      where: { collectorId_currencyCode_month: { collectorId, currencyCode, month } },
      update: { targetAmount: dto.targetAmount, setBy: actor.id },
      create: { collectorId, currencyCode, month, targetAmount: dto.targetAmount, setBy: actor.id },
    });
    await this.audit.log({ userId: actor.id, action: 'collector_target_updated', entityTable: 'collector_targets', entityId: target.id, oldValue: before, newValue: target, req });
    return target;
  }

  async kpi(actor: AuthUser, accountClass: 'customer' | 'advance' = 'customer') {
    const now = new Date();
    const currentStart = monthStart(now);
    const seriesStart = new Date(Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth() - 11, 1));
    const seriesEnd = nextMonth(currentStart);
    const previousStart = new Date(Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth() - 1, 1));
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const tomorrow = new Date(todayStart.getTime() + 86_400_000);

    const accountFilter = accountClass === 'advance'
      ? { customerType: 'advance' }
      : { OR: [{ customerType: null }, { customerType: { not: 'advance' } }] };
    const liveAging = await this.aging.report(actor, { accountClass });
    const balances = await this.prisma.customerBalance.findMany({
      where: { customer: { organizationId: actor.organizationId, status: { notIn: ['merged', 'import_reversed'] }, ...accountFilter } },
      include: { lastImportJob: { select: { id: true, importedAt: true } } },
    });
    const customerIds = [...new Set(balances.map((x) => x.customerId))];
    const jobIds = [...new Set(balances.map((x) => x.lastImportJobId).filter((x): x is string => !!x))];
    const [transactions, ledger, collections, promises, snapshots, targets, collectors] = await Promise.all([
      this.prisma.importedTransaction.findMany({ where: { importJobId: { in: jobIds }, customerId: { in: customerIds }, reversedAt: null, txDate: { lt: seriesEnd } } }),
      this.prisma.operationalLedger.findMany({ where: { customerId: { in: customerIds }, createdAt: { lt: seriesEnd } } }),
      this.prisma.collection.findMany({ where: { customer: accountFilter, collector: { user: { organizationId: actor.organizationId } }, status: { not: 'reversed' }, collectedAt: { gte: seriesStart, lt: seriesEnd } }, include: { collector: { include: { user: { select: { fullName: true } } } } } }),
      this.prisma.paymentPromise.findMany({ where: { customer: accountFilter, collector: { user: { organizationId: actor.organizationId } }, dueDate: { gte: seriesStart, lt: seriesEnd } }, include: { collector: { include: { user: { select: { fullName: true } } } } } }),
      this.prisma.agingSnapshot.findMany({ where: { organizationId: actor.organizationId, customer: accountFilter, asOf: { gte: seriesStart, lt: seriesEnd } } }),
      this.prisma.collectorTarget.findMany({ where: { collector: { user: { organizationId: actor.organizationId } }, month: { gte: seriesStart, lt: seriesEnd } } }),
      this.prisma.collector.findMany({ where: { active: true, user: { organizationId: actor.organizationId } }, include: { user: { select: { fullName: true } } } }),
    ]);

    const txByBalance = new Map<string, typeof transactions>();
    for (const tx of transactions) txByBalance.set(key(tx.customerId, tx.currencyCode), [...(txByBalance.get(key(tx.customerId, tx.currencyCode)) ?? []), tx]);
    const ledgerByBalance = new Map<string, typeof ledger>();
    for (const entry of ledger) ledgerByBalance.set(key(entry.customerId, entry.currencyCode), [...(ledgerByBalance.get(key(entry.customerId, entry.currencyCode)) ?? []), entry]);
    const snapshotByMonthCurrency = new Map<string, typeof snapshots>();
    for (const row of snapshots) snapshotByMonthCurrency.set(key(monthKey(row.asOf), row.currencyCode), [...(snapshotByMonthCurrency.get(key(monthKey(row.asOf), row.currencyCode)) ?? []), row]);

    const months = Array.from({ length: 12 }, (_, index) => new Date(Date.UTC(seriesStart.getUTCFullYear(), seriesStart.getUTCMonth() + index, 1)));
    const currencies = [...new Set([...balances.map((x) => x.currencyCode), ...collections.map((x) => x.currencyCode), ...targets.map((x) => x.currencyCode)])].sort();
    const trend = currencies.flatMap((currency) => months.map((month) => {
      const start = monthStart(month); const end = nextMonth(month);
      let opening = 0; let closing = 0; let sales = 0;
      for (const balance of balances.filter((x) => x.currencyCode === currency)) {
        const txs = (txByBalance.get(key(balance.customerId, currency)) ?? []).filter((x) => x.importJobId === balance.lastImportJobId);
        const entries = (ledgerByBalance.get(key(balance.customerId, currency)) ?? []).filter((x) => !balance.lastImportJob || x.createdAt > balance.lastImportJob.importedAt);
        const base = Number(balance.openingDebit) - Number(balance.openingCredit);
        const at = (date: Date) => base
          + txs.filter((x) => x.txDate < date).reduce((sum, x) => sum + Number(x.debit) - Number(x.credit), 0)
          + entries.filter((x) => x.createdAt < date).reduce((sum, x) => sum + Number(x.amountSigned), 0);
        opening += Math.max(0, at(start)); closing += Math.max(0, at(end));
        sales += txs.filter((x) => x.txDate >= start && x.txDate < end).reduce((sum, x) => sum + Number(x.debit), 0);
      }
      const monthSnapshots = snapshotByMonthCurrency.get(key(monthKey(month), currency)) ?? [];
      const isCurrentMonth = monthKey(month) === monthKey(currentStart);
      const liveTotals = liveAging.totals[currency];
      const currentReceivables = monthSnapshots.length
        ? monthSnapshots.reduce((sum, x) => sum + Number(x.bucket_0_30), 0)
        : isCurrentMonth && liveTotals ? liveTotals.bucket_0_30 : null;
      const buckets = monthSnapshots.reduce((acc, x) => ({
        bucket_0_30: acc.bucket_0_30 + Number(x.bucket_0_30), bucket_31_60: acc.bucket_31_60 + Number(x.bucket_31_60),
        bucket_61_90: acc.bucket_61_90 + Number(x.bucket_61_90), bucket_91_120: acc.bucket_91_120 + Number(x.bucket_91_120),
        bucket_120_plus: acc.bucket_120_plus + Number(x.bucket_120_plus), undated: acc.undated + Number(x.undated),
      }), { bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_91_120: 0, bucket_120_plus: 0, undated: 0 });
      const liveBuckets = isCurrentMonth && liveTotals ? liveTotals : null;
      const averageDebtAge = monthSnapshots.length ? weightedDebtAge(buckets) : liveBuckets ? weightedDebtAge(liveBuckets) : null;
      const rollingStart = new Date(end.getTime() - 90 * 86_400_000);
      const rollingSales = balances.filter((x) => x.currencyCode === currency).reduce((sum, balance) => {
        const txs = txByBalance.get(key(balance.customerId, currency)) ?? [];
        return sum + txs.filter((x) => x.txDate >= rollingStart && x.txDate < end).reduce((subtotal, x) => subtotal + Number(x.debit), 0);
      }, 0);
      const dso = sales > 0 ? calculateDso(closing, sales, new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate())
        : isCurrentMonth && rollingSales > 0 ? closing / (rollingSales / 90) : null;
      return {
        month: monthKey(month), currency, opening, sales, closing,
        dso,
        cei: calculateCei(opening, sales, closing, currentReceivables),
        averageDebtAge,
        undatedDebt: liveBuckets ? liveBuckets.undated : buckets.undated,
        closedSnapshot: monthSnapshots.length > 0,
        liveEstimate: !monthSnapshots.length && isCurrentMonth && !!liveTotals,
      };
    }));

    const targetMap = new Map(targets.map((x) => [key(`${x.collectorId}|${monthKey(x.month)}`, x.currencyCode), Number(x.targetAmount)]));
    const rows = collectors.flatMap((collector) => currencies.map((currency) => {
      const currentCollections = collections.filter((x) => x.collectorId === collector.id && x.currencyCode === currency && x.collectedAt >= currentStart);
      const previousCollections = collections.filter((x) => x.collectorId === collector.id && x.currencyCode === currency && x.collectedAt >= previousStart && x.collectedAt < currentStart);
      const amount = currentCollections.reduce((sum, x) => sum + Number(x.amount), 0);
      const previousAmount = previousCollections.reduce((sum, x) => sum + Number(x.amount), 0);
      const dailyAmount = currentCollections.filter((x) => x.collectedAt >= todayStart && x.collectedAt < tomorrow).reduce((sum, x) => sum + Number(x.amount), 0);
      const relevantPromises = promises.filter((x) => x.collectorId === collector.id && x.currencyCode === currency && x.dueDate >= currentStart);
      const fulfilled = relevantPromises.filter((x) => x.status === 'fulfilled').length;
      const promiseRate = safePercent(fulfilled, relevantPromises.length);
      const target = targetMap.get(key(`${collector.id}|${monthKey(currentStart)}`, currency)) ?? null;
      return { collectorId: collector.id, collectorName: collector.user.fullName, currency, dailyAmount, monthlyAmount: amount, previousMonthAmount: previousAmount, target, attainment: target === null ? null : safePercent(amount, target), promisesFulfilled: fulfilled, promisesTotal: relevantPromises.length, promiseRate };
    }));

    const leaderboard = rows.map((row) => ({ ...row, score: (row.attainment ?? 0) * 0.6 + (row.promiseRate ?? 0) * 0.4 }));
    for (const currency of currencies) {
      const current = leaderboard.filter((x) => x.currency === currency).sort((a, b) => b.score - a.score);
      const previous = [...current].sort((a, b) => b.previousMonthAmount - a.previousMonthAmount);
      current.forEach((row, index) => Object.assign(row, { rank: index + 1, previousRank: previous.findIndex((x) => x.collectorId === row.collectorId) + 1, rankChange: previous.findIndex((x) => x.collectorId === row.collectorId) - index }));
    }
    const latestByCurrency = Object.fromEntries(currencies.map((currency) => {
      const series = trend.filter((x) => x.currency === currency);
      const latest = series[series.length - 1]; const previous = series[series.length - 2];
      return [currency, { ...latest, debtAgeDeterioration: latest.averageDebtAge !== null && previous?.averageDebtAge !== null ? latest.averageDebtAge - previous.averageDebtAge : null }];
    }));
    return { generatedAt: now, accountClass, methodology: { dso: 'closing receivables ÷ credit sales × days; current month falls back to trailing 90-day sales', cei: '(opening + sales − closing) ÷ (opening + sales − current receivables)', currenciesSeparated: true }, latestByCurrency, trend, collectors: rows, leaderboard: leaderboard.sort((a, b) => a.currency.localeCompare(b.currency) || b.score - a.score), dataQuality: { monthsWithoutAgingSnapshot: trend.filter((x) => !x.closedSnapshot && !x.liveEstimate).map((x) => `${x.month}|${x.currency}`) } };
  }
}
