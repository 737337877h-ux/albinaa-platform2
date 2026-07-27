import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execFileAsync = promisify(execFile);

/** بنية مخرجات الـ Parser (JSON من parser_cli.py). */
export interface ParsedTransaction {
  rowNumber: number;
  date: string;
  docType: string;
  docNumber: string | null;
  description: string;
  reference: string | null;
  debit: number;
  credit: number;
  lineHash: string;
}
export interface ParsedAccount {
  customerCode: string;
  customerName: string;
  currency: string;       // ISO
  currencyRaw: string;    // كما في الملف
  currencyName: string;
  openingDebit: number;
  openingCredit: number;
  computedBalance: number;
  declaredBalance: number | null;
  declaredLabel: string | null;
  fragments: number;
  warnings: string[];
  transactions: ParsedTransaction[];
}
export interface ParseResultJson {
  ok: boolean;
  error?: string;
  stats: {
    accounts: number; customers: number; transactions: number;
    fragmented_accounts: number; errors: number; empty_rows_skipped: number;
  };
  accounts: ParsedAccount[];
  errors: { rowNumber: number; message: string; raw: unknown[] }[];
  skippedEmptyRows: number;
}

/**
 * جسر الـ Parser: يستدعي المعالج البايثوني المُختبر (قرار موثق — لا إعادة كتابة
 * لمنطق تحليل تم اختباره على 18,569 صفًا حقيقيًا بمطابقة أرصدة 100%).
 * NestJS مسؤول عن كل ما بعد التحليل: القواعد، الكتابة في القاعدة، التقارير.
 */
@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name);
  private readonly cliPath = path.resolve(
    process.env.PARSER_DIR ?? path.join(__dirname, '..', '..', 'parser'),
    'parser_cli.py',
  );

  async parse(filePath: string): Promise<ParseResultJson> {
    try {
      const { stdout } = await execFileAsync(
        process.env.PYTHON_BIN ?? 'python3',
        [this.cliPath, filePath],
        { maxBuffer: 256 * 1024 * 1024, timeout: 120_000 },
      );
      const result: ParseResultJson = JSON.parse(stdout);
      if (!result.ok) {
        throw new BadRequestException(`الملف غير قابل للتحليل: ${result.error}`);
      }
      return result;
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.error(`فشل تشغيل الـ Parser: ${e instanceof Error ? e.message : e}`);
      throw new BadRequestException('تعذّر تحليل الملف — تأكد أنه ملف Excel سليم بالبنية المتوقعة');
    }
  }
}
