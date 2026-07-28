import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Request } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ParseResultJson, ParserService } from './parser.service';

const CHUNK = 500;

/** تطبيع اسم لكشف التشابه — مطابق لدالة الـ Parser (موثق في مرحلة التحقق). */
function normalizeName(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);
  private readonly uploadDir = process.env.UPLOAD_DIR ?? path.resolve('uploads');

  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: ParserService,
    private readonly audit: AuditService,
  ) {}

  // --------------------------------------------------------------------------
  // المرحلة 1+2+3+4 من الـ Workflow: رفع + تحقق + تحليل + معاينة (dry_run)
  // --------------------------------------------------------------------------
  async upload(actor: AuthUser, file: Express.Multer.File, req?: Request) {
    if (!file) throw new BadRequestException('لم يُرفق ملف — الحقل المطلوب: file');
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.xlsx', '.xlsm'].includes(ext)) {
      throw new BadRequestException('الصيغة المدعومة حاليًا: xlsx (بنية كشف الحساب المعتمدة)');
    }

    await fs.mkdir(this.uploadDir, { recursive: true });
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');

    // تحذير تكرار الملف (بدون منع — إعادة الاستيراد آمنة بحكم line_hash)
    const previousJob = await this.prisma.importJob.findFirst({
      where: { organizationId: actor.organizationId, fileHash, status: 'completed' },
      orderBy: { importedAt: 'desc' },
    });

    const storedName = `${Date.now()}_${fileHash.slice(0, 12)}${ext}`;
    const storedPath = path.join(this.uploadDir, storedName);
    await fs.writeFile(storedPath, file.buffer);

    // تحليل فعلي عبر الـ Parser المُختبر
    const parsed = await this.parser.parse(storedPath);

    // أخطاء إضافية على مستوى القواعد (لا توقف الاستيراد — تُسجَّل ويُتابع):
    const ruleErrors: { rowNumber: number | null; message: string; context?: string }[] = [];
    const knownCurrencies = new Set(
      (await this.prisma.currency.findMany({ where: { active: true } })).map((c) => c.code),
    );
    let importableAccounts = 0;
    let importableTxns = 0;
    for (const acc of parsed.accounts) {
      if (!acc.customerCode || acc.customerCode === 'None') {
        ruleErrors.push({
          rowNumber: null,
          message: 'كود عميل ناقص — الحساب مستبعد بالكامل',
          context: acc.customerName,
        });
        continue;
      }
      if (!knownCurrencies.has(acc.currency)) {
        ruleErrors.push({
          rowNumber: null,
          message: `عملة غير معروفة (${acc.currencyRaw}) — الحساب مستبعد. أضفها من الإعدادات ثم أعد التنفيذ`,
          context: `${acc.customerCode} ${acc.customerName}`,
        });
        continue;
      }
      importableAccounts += 1;
      importableTxns += acc.transactions.length;
    }

    // حفظ ناتج التحليل بجانب الملف — التنفيذ لاحقًا لا يعيد التحليل
    const parsedPath = `${storedPath}.parsed.json`;
    await fs.writeFile(parsedPath, JSON.stringify(parsed), 'utf-8');

    const job = await this.prisma.importJob.create({
      data: {
        organizationId: actor.organizationId,
        fileName: file.originalname,
        fileHash,
        uploadedBy: actor.id,
        status: 'dry_run',
        rowsTotal: parsed.stats.transactions + parsed.stats.errors + parsed.skippedEmptyRows,
        txnsInFile: parsed.stats.transactions,
        errorsCount: parsed.stats.errors + ruleErrors.length,
        errorReport: {
          storedPath,
          parsedPath,
          parserErrors: parsed.errors,
          ruleErrors,
          accountWarnings: parsed.accounts
            .filter((a) => a.warnings.length)
            .map((a) => ({ account: `${a.customerCode}/${a.currency}`, warnings: a.warnings })),
        } as any,
      },
    });

    await this.audit.log({
      userId: actor.id, action: 'import_uploaded', entityTable: 'import_jobs', entityId: job.id,
      newValue: { fileName: file.originalname, fileHash }, req,
    });

    // المعاينة — المرحلة 4 من الـ Workflow
    return {
      jobId: job.id,
      status: 'dry_run',
      previouslyImported: previousJob
        ? { jobId: previousJob.id, importedAt: previousJob.importedAt }
        : null,
      preview: {
        accountsInFile: parsed.stats.accounts,
        customersInFile: parsed.stats.customers,
        transactionsInFile: parsed.stats.transactions,
        fragmentedAccountsMerged: parsed.stats.fragmented_accounts,
        importableAccounts,
        importableTransactions: importableTxns,
        parserErrors: parsed.errors.length,
        ruleErrors: ruleErrors.length,
        sampleAccounts: parsed.accounts.slice(0, 5).map((a) => ({
          customerCode: a.customerCode,
          customerName: a.customerName,
          currency: a.currency,
          computedBalance: a.computedBalance,
          declaredBalance: a.declaredBalance,
          transactions: a.transactions.length,
        })),
      },
      nextStep: `POST /imports/${job.id}/execute لاعتماد الاستيراد`,
    };
  }

  // --------------------------------------------------------------------------
  // المرحلة 5+6: تنفيذ الاستيراد + التقرير النهائي
  // --------------------------------------------------------------------------
  async execute(actor: AuthUser, jobId: string, force: boolean, req?: Request) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, organizationId: actor.organizationId },
    });
    if (!job) throw new NotFoundException('عملية الاستيراد غير موجودة');
    if (job.status === 'completed') {
      throw new ConflictException('هذه العملية نُفذت مسبقًا — ارفع الملف من جديد لعملية جديدة');
    }
    if (job.status !== 'dry_run') {
      throw new ConflictException(`لا يمكن تنفيذ عملية بحالة ${job.status}`);
    }

    const report = job.errorReport as any;
    const previous = await this.prisma.importJob.findFirst({
      where: {
        organizationId: actor.organizationId, fileHash: job.fileHash,
        status: 'completed', id: { not: jobId },
      },
    });
    if (previous && !force) {
      throw new ConflictException(
        'الملف نفسه استورد سابقًا. إعادة التنفيذ آمنة (لن تتكرر بيانات) — أرسل force=true للتأكيد',
      );
    }

    const started = Date.now();
    await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'running' } });

    try {
      const parsed: ParseResultJson = JSON.parse(await fs.readFile(report.parsedPath, 'utf-8'));
      const result = await this.applyImport(actor, jobId, parsed, report.ruleErrors ?? []);
      const durationMs = Date.now() - started;

      const updated = await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          importedAt: new Date(),
          customersNew: result.customersNew,
          customersUpdated: result.customersUpdated,
          txnsInserted: result.txnsInserted,
          txnsSkippedDuplicate: result.txnsSkipped,
          totalBalanceBefore: result.totalsBefore as any,
          totalBalanceAfter: result.totalsAfter as any,
          errorReport: {
            ...report,
            executeErrors: result.executeErrors,
            durationMs,
            duplicateNamePairsFlagged: result.dupPairs,
            reconciliationsOpened: result.reconciliations,
          } as any,
        },
      });

      await this.audit.log({
        userId: actor.id, action: 'import_executed', entityTable: 'import_jobs', entityId: jobId,
        newValue: {
          customersNew: result.customersNew, customersUpdated: result.customersUpdated,
          txnsInserted: result.txnsInserted, txnsSkipped: result.txnsSkipped, durationMs,
        }, req,
      });

      return this.buildReport(updated);
    } catch (e) {
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          errorReport: { ...report, fatal: e instanceof Error ? e.message : String(e) } as any,
        },
      });
      this.logger.error(`فشل تنفيذ الاستيراد ${jobId}`, e instanceof Error ? e.stack : String(e));
      throw new BadRequestException('فشل تنفيذ الاستيراد — راجع /imports/{id}/errors. إعادة التنفيذ آمنة');
    }
  }

  /** قواعد الاستيراد المعتمدة — كتابة القاعدة. Idempotent بالكامل بحكم line_hash وقيود الفريدة. */
  private async applyImport(
    actor: AuthUser,
    jobId: string,
    parsed: ParseResultJson,
    _ruleErrors: any[],
  ) {
    const executeErrors: { account: string; message: string }[] = [];
    const knownCurrencies = new Set(
      (await this.prisma.currency.findMany({ where: { active: true } })).map((c) => c.code),
    );

    // أنواع المستندات: الموجود يُستخدم، والجديد يُنشأ آليًا بعلامة مراجعة (لا توقف)
    const docTypes = new Map(
      (await this.prisma.documentType.findMany({
        where: { organizationId: actor.organizationId },
      })).map((d) => [d.name, d.id]),
    );
    const allDocTypeNames = new Set<string>();
    for (const acc of parsed.accounts) {
      for (const t of acc.transactions) allDocTypeNames.add(t.docType);
    }
    for (const name of allDocTypeNames) {
      if (!docTypes.has(name)) {
        const created = await this.prisma.documentType.create({
          data: {
            organizationId: actor.organizationId, name, effect: 'mixed',
            notes: 'أُنشئ تلقائيًا أثناء الاستيراد — يحتاج مراجعة الأثر المحاسبي',
          },
        });
        docTypes.set(name, created.id);
      }
    }

    const totalsBefore = await this.balanceTotals(actor.organizationId);

    let customersNew = 0;
    let customersUpdated = 0;
    let txnsInserted = 0;
    let txnsSkipped = 0;
    let reconciliations = 0;

    // هل توجد قيود دفتر تشغيلي أصلاً؟ (لتفعيل التسوية عند وجود تحصيلات مسجلة)
    const ledgerExists = (await this.prisma.operationalLedger.count()) > 0;

    const seenCustomerIds = new Map<string, string>(); // code -> id

    for (const acc of parsed.accounts) {
      try {
        if (!acc.customerCode || acc.customerCode === 'None') continue; // سُجل في المعاينة
        if (!knownCurrencies.has(acc.currency)) continue;               // سُجل في المعاينة

        // ---- منع تكرار العملاء: upsert على (org, code) ----
        let customerId = seenCustomerIds.get(acc.customerCode);
        if (!customerId) {
          const existing = await this.prisma.customer.findUnique({
            where: {
              organizationId_externalCustomerCode: {
                organizationId: actor.organizationId,
                externalCustomerCode: acc.customerCode,
              },
            },
          });
          // نوع محلي محدد صراحةً (string لا string|undefined): كلا فرعي
          // if/else يعيّنانه قطعًا، فيتحقق التخصيص النهائي بلا لبس لـ TS
          // (خطأ TS2345 المُبلَّغ عنه كان بسبب الاعتماد على تضييق نوع
          // customerId نفسه عبر الفرعين المتداخلين).
          let resolvedId: string;
          if (existing) {
            resolvedId = existing.id;
            customersUpdated += 1;
            if (existing.name !== acc.customerName) {
              await this.prisma.customer.update({
                where: { id: existing.id },
                data: {
                  name: acc.customerName,
                  nameNormalized: normalizeName(acc.customerName),
                  updatedAt: new Date(),
                },
              });
            }
          } else {
            const created = await this.prisma.customer.create({
              data: {
                organizationId: actor.organizationId,
                externalCustomerCode: acc.customerCode,
                name: acc.customerName,
                nameNormalized: normalizeName(acc.customerName),
                createdByImportJob: jobId,
              },
            });
            resolvedId = created.id;
            customersNew += 1;
          }
          customerId = resolvedId;
          seenCustomerIds.set(acc.customerCode, resolvedId);
        }

        // ---- الحركات: منع التكرار بقيد line_hash الفريد + skipDuplicates ----
        for (let i = 0; i < acc.transactions.length; i += CHUNK) {
          const chunk = acc.transactions.slice(i, i + CHUNK);
          const res = await this.prisma.importedTransaction.createMany({
            data: chunk.map((t) => ({
              customerId: customerId!,
              currencyCode: acc.currency,
              documentTypeId: docTypes.get(t.docType)!,
              txDate: new Date(t.date),
              documentNumber: t.docNumber,
              description: t.description,
              referenceNumber: t.reference,
              debit: t.debit,
              credit: t.credit,
              lineHash: t.lineHash,
              sourceRowNumber: t.rowNumber,
              importJobId: jobId,
            })),
            skipDuplicates: true,
          });
          txnsInserted += res.count;
          txnsSkipped += chunk.length - res.count;
        }

        // ---- التسوية (قبل تحديث الرصيد): تُفتح فقط إذا وُجدت قيود تشغيلية منذ آخر استيراد ----
        const prevBalance = await this.prisma.customerBalance.findUnique({
          where: { customerId_currencyCode: { customerId, currencyCode: acc.currency } },
          include: { lastImportJob: { select: { importedAt: true } } },
        });
        if (ledgerExists && prevBalance?.lastImportJob) {
          const ledgerSum = await this.prisma.operationalLedger.aggregate({
            _sum: { amountSigned: true },
            where: {
              customerId, currencyCode: acc.currency,
              createdAt: { gt: prevBalance.lastImportJob.importedAt },
            },
          });
          const ledgerDelta = Number(ledgerSum._sum.amountSigned ?? 0);
          if (ledgerDelta !== 0) {
            const operational = Number(prevBalance.accountingBalance) + ledgerDelta;
            const difference = acc.computedBalance - operational;
            await this.prisma.balanceReconciliation.upsert({
              where: {
                customerId_currencyCode_importJobId: {
                  customerId, currencyCode: acc.currency, importJobId: jobId,
                },
              },
              update: {},
              create: {
                customerId, currencyCode: acc.currency, importJobId: jobId,
                accountingBalance: acc.computedBalance,
                operationalBalance: operational,
                difference,
                reviewStatus: difference === 0 ? 'approved' : 'pending',
              },
            });
            reconciliations += 1;
          }
        }

        // ---- الرصيد حسب العملة: upsert على القيد الفريد (customer, currency) ----
        await this.prisma.customerBalance.upsert({
          where: { customerId_currencyCode: { customerId, currencyCode: acc.currency } },
          update: {
            openingDebit: acc.openingDebit,
            openingCredit: acc.openingCredit,
            accountingBalance: acc.computedBalance,
            declaredBalance: acc.declaredBalance,
            declaredLabel: acc.declaredLabel,
            lastImportJobId: jobId,
            updatedAt: new Date(),
          },
          create: {
            customerId,
            currencyCode: acc.currency,
            openingDebit: acc.openingDebit,
            openingCredit: acc.openingCredit,
            accountingBalance: acc.computedBalance,
            declaredBalance: acc.declaredBalance,
            declaredLabel: acc.declaredLabel,
            lastImportJobId: jobId,
          },
        });

        // ---- Snapshot تاريخي لكل استيراد ----
        await this.prisma.balanceSnapshot.create({
          data: {
            customerId, currencyCode: acc.currency,
            balance: acc.computedBalance, importJobId: jobId,
          },
        });
      } catch (e) {
        // خطأ في حساب واحد لا يوقف البقية — يُسجَّل ويُتابع (متطلب صريح)
        executeErrors.push({
          account: `${acc.customerCode}/${acc.currency}`,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // ---- كشف تشابه الأسماء (تنبيه فقط — لا دمج تلقائي أبدًا) ----
    let dupPairs = 0;
    const dupGroups = await this.prisma.customer.groupBy({
      by: ['nameNormalized'],
      where: { organizationId: actor.organizationId },
      having: { nameNormalized: { _count: { gt: 1 } } },
      _count: true,
    });
    for (const g of dupGroups) {
      const members = await this.prisma.customer.findMany({
        where: { organizationId: actor.organizationId, nameNormalized: g.nameNormalized },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      for (let a = 0; a < members.length; a += 1) {
        for (let b = a + 1; b < members.length; b += 1) {
          await this.prisma.potentialDuplicateCustomer.upsert({
            where: {
              customerAId_customerBId: {
                customerAId: members[a].id, customerBId: members[b].id,
              },
            },
            update: {},
            create: {
              customerAId: members[a].id,
              customerBId: members[b].id,
              matchReason: 'تطابق اسم تام بعد التطبيع مع اختلاف الكود',
            },
          });
          dupPairs += 1;
        }
      }
    }

    const totalsAfter = await this.balanceTotals(actor.organizationId);
    return {
      customersNew, customersUpdated, txnsInserted, txnsSkipped,
      executeErrors, dupPairs, reconciliations, totalsBefore, totalsAfter,
    };
  }

  private async balanceTotals(orgId: string): Promise<Record<string, number>> {
    const rows = await this.prisma.customerBalance.groupBy({
      by: ['currencyCode'],
      where: { customer: { organizationId: orgId } },
      _sum: { accountingBalance: true },
    });
    return Object.fromEntries(
      rows.map((r) => [r.currencyCode, Number(r._sum.accountingBalance ?? 0)]),
    );
  }

  // --------------------------------------------------------------------------
  // الاستعلامات
  // --------------------------------------------------------------------------
  async findAll(actor: AuthUser) {
    const jobs = await this.prisma.importJob.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { importedAt: 'desc' },
      select: {
        id: true, fileName: true, status: true, importedAt: true,
        txnsInFile: true, txnsInserted: true, txnsSkippedDuplicate: true,
        customersNew: true, customersUpdated: true, errorsCount: true,
        uploader: { select: { id: true, fullName: true } },
      },
    });
    return jobs;
  }

  async findOne(actor: AuthUser, id: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { uploader: { select: { id: true, fullName: true } } },
    });
    if (!job) throw new NotFoundException('عملية الاستيراد غير موجودة');
    const { errorReport: _errorReport, ...rest } = job as any;
    return rest;
  }

  async getReport(actor: AuthUser, id: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!job) throw new NotFoundException('عملية الاستيراد غير موجودة');
    return this.buildReport(job);
  }

  /** التقرير النهائي — كل العدادات التسعة المطلوبة في متطلبات المرحلة. */
  private buildReport(job: any) {
    const er = (job.errorReport ?? {}) as any;
    const parserErrors = (er.parserErrors ?? []).length;
    const ruleErrors = (er.ruleErrors ?? []).length;
    const executeErrors = (er.executeErrors ?? []).length;
    return {
      jobId: job.id,
      fileName: job.fileName,
      status: job.status,
      importedAt: job.importedAt,
      rowsRead: job.rowsTotal,                                   // عدد الصفوف المقروءة
      rowsImported: job.txnsInserted,                            // المستوردة فعلاً
      rowsIgnored: (job.txnsSkippedDuplicate ?? 0) + parserErrors + ruleErrors, // المتجاهلة
      errorsCount: parserErrors + ruleErrors + executeErrors,    // الأخطاء
      customersNew: job.customersNew,                            // العملاء الجدد
      customersUpdated: job.customersUpdated,                    // المحدثون
      transactionsNew: job.txnsInserted,                         // الحركات الجديدة
      transactionsDuplicate: job.txnsSkippedDuplicate,           // المكررة
      durationMs: er.durationMs ?? null,                         // الزمن المستغرق
      balancesBefore: job.totalBalanceBefore,
      balancesAfter: job.totalBalanceAfter,
      duplicateNamePairsFlagged: er.duplicateNamePairsFlagged ?? 0,
      reconciliationsOpened: er.reconciliationsOpened ?? 0,
    };
  }

  async getErrors(actor: AuthUser, id: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!job) throw new NotFoundException('عملية الاستيراد غير موجودة');
    const er = (job.errorReport ?? {}) as any;
    return {
      jobId: job.id,
      parserErrors: er.parserErrors ?? [],     // صفوف تالفة (مدين+دائن معًا، سالب...)
      ruleErrors: er.ruleErrors ?? [],         // عملة غير معروفة، كود ناقص...
      executeErrors: er.executeErrors ?? [],   // أخطاء أثناء الكتابة (حساب-بحساب)
      accountWarnings: er.accountWarnings ?? [],
      fatal: er.fatal ?? null,
    };
  }
}
