import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execFileAsync = promisify(execFile);

/* ─────────────────────── Cross-platform Python detection ──────────────────── */

const CANDIDATES = ['python3', 'python', 'py'] as const;

/**
 * Try to locate a working Python interpreter.
 * Order: explicit PYTHON_BIN env → python3 → python → py
 * Returns the command string on success, throws with install instructions on failure.
 * Exported as a pure function for unit testing.
 */
export function resolvePythonBin(envBin?: string): string {
  // 1) Explicit override always wins
  if (envBin && envBin.trim()) {
    try {
      execFileSync(envBin, ['--version'], { timeout: 5_000, stdio: 'pipe' });
      return envBin;
    } catch {
      throw new Error(
        `PYTHON_BIN="${envBin}" is set but not working. ` +
        `Verify the path or remove PYTHON_BIN to auto-detect.`,
      );
    }
  }

  // 2) Auto-detect
  const tried: string[] = [];
  for (const cmd of CANDIDATES) {
    try {
      execFileSync(cmd, ['--version'], { timeout: 5_000, stdio: 'pipe' });
      return cmd;
    } catch {
      tried.push(cmd);
    }
  }

  // 3) Nothing found
  const isWin = process.platform === 'win32';
  const installHint = isWin
    ? 'Install Python from https://www.python.org/downloads/ or run: winget install Python.Python.3.12'
    : 'Install Python via your package manager, e.g.: apt install python3 / brew install python3';
  throw new Error(
    `No Python interpreter found (tried: ${tried.join(', ')}).\n` +
    `${installHint}\n` +
    `You can also set the PYTHON_BIN environment variable to the full path of your Python executable.`,
  );
}

/* ─────────────────────────── Types (unchanged) ───────────────────────────── */

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

  /** Cached Python command after first successful detection. */
  private pythonBin: string | null = null;

  private getPythonBin(): string {
    if (this.pythonBin) return this.pythonBin;
    this.pythonBin = resolvePythonBin(process.env.PYTHON_BIN);
    this.logger.log(`Python detected: ${this.pythonBin}`);
    return this.pythonBin;
  }

  async parse(filePath: string): Promise<ParseResultJson> {
    let pythonBin: string;
    try {
      pythonBin = this.getPythonBin();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(msg);
      throw new BadRequestException(msg);
    }

    try {
      const { stdout } = await execFileAsync(
        pythonBin,
        [this.cliPath, filePath],
        { maxBuffer: 256 * 1024 * 1024, timeout: 120_000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
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
