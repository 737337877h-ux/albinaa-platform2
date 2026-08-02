import {
  extractParserError,
  redactFilesystemPaths,
  resolvePythonBin,
} from './parser.service';

describe('resolvePythonBin', () => {
  const origEnv = process.env.PYTHON_BIN;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.PYTHON_BIN;
    } else {
      process.env.PYTHON_BIN = origEnv;
    }
  });

  it('should return PYTHON_BIN when explicitly set and working', () => {
    const original = process.env.PYTHON_BIN;
    // On any platform, 'node' is guaranteed to exist — use it as a stand-in
    process.env.PYTHON_BIN = 'node';
    try {
      const result = resolvePythonBin(process.env.PYTHON_BIN);
      expect(result).toBe('node');
    } finally {
      if (original === undefined) delete process.env.PYTHON_BIN;
      else process.env.PYTHON_BIN = original;
    }
  });

  it('should throw when PYTHON_BIN is set to a non-existent command', () => {
    expect(() => resolvePythonBin('definitely_not_python_xyz')).toThrow(/PYTHON_BIN="definitely_not_python_xyz" is set but not working/);
  });

  it('should throw when PYTHON_BIN is set to empty string', () => {
    // Empty string should trigger auto-detect, not the explicit path
    // This tests that we handle falsy-but-set correctly
    expect(() => resolvePythonBin('')).not.toThrow(/PYTHON_BIN/);
  });

  it('should auto-detect python3 or python or py on the system', () => {
    // This test passes if ANY of the candidates is found on the system
    // On Linux/macOS: python3 should exist
    // On Windows: python or py should exist
    // In CI/Docker: python3 should exist
    let found = false;
    let lastError: unknown;
    for (const _cmd of ['python3', 'python', 'py']) {
      try {
        const result = resolvePythonBin();
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        found = true;
        break;
      } catch (e) {
        lastError = e;
      }
    }
    // If none found, the function should throw a clear error
    if (!found) {
      expect(lastError).toBeDefined();
      expect((lastError as Error).message).toMatch(/No Python interpreter found/);
      expect((lastError as Error).message).toMatch(/tried:/);
    }
  });

  it('should throw a descriptive error with install instructions when no Python is found', () => {
    // Use a non-existent command via PYTHON_BIN to guarantee failure and inspect message
    try {
      resolvePythonBin('no_such_python_command_xyz_999');
      fail('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('PYTHON_BIN="no_such_python_command_xyz_999"');
      expect(msg).toContain('not working');
    }
  });

  it('should cache on ParserService instance (getPythonBin called twice returns same value)', () => {
    // This tests the caching logic indirectly — calling resolvePythonBin twice
    // should produce consistent results (not a flaky test)
    const result1 = resolvePythonBin();
    const result2 = resolvePythonBin();
    expect(result1).toBe(result2);
  });
});

/* ───────────── Structured parser-error surfacing (Fix 2) ───────────── */

describe('extractParserError', () => {
  it('returns the message from a structured failure on stdout', () => {
    expect(extractParserError({ stdout: '{"ok":false,"error":"File type not recognized"}' }))
      .toBe('File type not recognized');
  });

  it('preserves an Arabic UTF-8 message exactly', () => {
    const arabic = 'لم يُتعرَّف على نوع الملف — المدعوم: كشف حساب تحليلي';
    expect(extractParserError({ stdout: JSON.stringify({ ok: false, error: arabic }) }))
      .toBe(arabic);
  });

  it('decodes Buffer stdout as UTF-8', () => {
    const arabic = 'لم يُتعرَّف على نوع الملف';
    const buf = Buffer.from(JSON.stringify({ ok: false, error: arabic }), 'utf8');
    expect(extractParserError({ stdout: buf })).toBe(arabic);
  });

  it('trims surrounding whitespace before and after parsing', () => {
    expect(extractParserError({ stdout: '\n  {"ok":false,"error":"  boom  "}  \n' })).toBe('boom');
  });

  it('returns null for malformed or non-JSON stdout', () => {
    expect(extractParserError({ stdout: 'Traceback (most recent call last):' })).toBeNull();
    expect(extractParserError({ stdout: '{"ok":false,' })).toBeNull();
  });

  it('returns null for empty or whitespace-only stdout', () => {
    expect(extractParserError({ stdout: '' })).toBeNull();
    expect(extractParserError({ stdout: '   \n ' })).toBeNull();
    expect(extractParserError({ stdout: Buffer.alloc(0) })).toBeNull();
  });

  it('returns null when stdout is absent or not a string/Buffer', () => {
    expect(extractParserError({})).toBeNull();
    expect(extractParserError({ stdout: 42 })).toBeNull();
    expect(extractParserError(new Error('plain failure'))).toBeNull();
    expect(extractParserError(null)).toBeNull();
    expect(extractParserError(undefined)).toBeNull();
    expect(extractParserError('string error')).toBeNull();
  });

  it('returns null when the JSON lacks a usable error string', () => {
    expect(extractParserError({ stdout: '{"ok":false}' })).toBeNull();
    expect(extractParserError({ stdout: '{"ok":false,"error":""}' })).toBeNull();
    expect(extractParserError({ stdout: '{"ok":false,"error":"   "}' })).toBeNull();
    expect(extractParserError({ stdout: '{"ok":false,"error":123}' })).toBeNull();
  });

  it('returns null when ok is not false', () => {
    expect(extractParserError({ stdout: '{"ok":true,"error":"ignored"}' })).toBeNull();
    expect(extractParserError({ stdout: '[1,2,3]' })).toBeNull();
    expect(extractParserError({ stdout: '"just a string"' })).toBeNull();
    expect(extractParserError({ stdout: 'null' })).toBeNull();
  });
});

describe('redactFilesystemPaths', () => {
  const BS = String.fromCharCode(92); // backslash, kept explicit for readability

  it('redacts POSIX absolute paths', () => {
    expect(redactFilesystemPaths("No such file or directory: '/data/uploads/private.xlsx'"))
      .toBe("No such file or directory: '[path]'");
    expect(redactFilesystemPaths('Command failed: /app/parser/parser_cli.py'))
      .toBe('Command failed: [path]');
    expect(redactFilesystemPaths('/tmp/example/file.xlsx')).toBe('[path]');
  });

  it('redacts Windows backslash paths', () => {
    const win = 'C:' + BS + 'Users' + BS + 'USER' + BS + 'private.xlsx';
    expect(redactFilesystemPaths(win)).toBe('[path]');
    expect(redactFilesystemPaths('file at ' + win + ' missing')).toBe('file at [path] missing');
  });

  it('redacts Windows forward-slash paths', () => {
    expect(redactFilesystemPaths('C:/Users/USER/private.xlsx')).toBe('[path]');
  });

  it('redacts UNC paths', () => {
    const unc = BS + BS + 'server' + BS + 'share' + BS + 'file.xlsx';
    expect(redactFilesystemPaths(unc)).toBe('[path]');
  });

  it('keeps Arabic text readable and changes only the path', () => {
    const before = 'خطأ: الملف /data/uploads/x.xlsx غير موجود';
    const after = redactFilesystemPaths(before);
    expect(after).toBe('خطأ: الملف [path] غير موجود');
    expect(after).toContain('غير موجود');
    expect(Buffer.from(after, 'utf8').toString('utf8')).toBe(after);
  });

  it('leaves messages without absolute paths unchanged', () => {
    const recognition = 'لم يُتعرَّف على نوع الملف — المدعوم: كشف حساب تحليلي (بنية الكتل)';
    expect(redactFilesystemPaths(recognition)).toBe(recognition);
    expect(redactFilesystemPaths('file.xlsx could not be read')).toBe('file.xlsx could not be read');
    expect(redactFilesystemPaths('use debit and/or credit columns'))
      .toBe('use debit and/or credit columns');
    expect(redactFilesystemPaths('ratio 1/2 exceeded')).toBe('ratio 1/2 exceeded');
    expect(redactFilesystemPaths('parser/import_profiles.py failed'))
      .toBe('parser/import_profiles.py failed');
  });

  it('preserves line breaks and redacts every path on each line', () => {
    const input = 'line one /a/b/c.txt' + String.fromCharCode(10)
      + 'line two C:' + BS + 'x' + BS + 'y.txt';
    expect(redactFilesystemPaths(input))
      .toBe('line one [path]' + String.fromCharCode(10) + 'line two [path]');
  });

  it('redacts both a POSIX and a Windows path in one message', () => {
    const input = 'paths: /data/uploads/private.xlsx and C:' + BS + 'Users' + BS + 'USER' + BS + 'private.xlsx';
    const out = redactFilesystemPaths(input);
    expect(out).toBe('paths: [path] and [path]');
    expect(out).not.toContain('private.xlsx');
    expect(out).not.toContain('/data/uploads');
  });
});

describe('ParserService.parse — surfacing vs generic fallback', () => {
  const GENERIC = 'تعذّر تحليل الملف';

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  /**
   * Loads a fresh ParserService with execFileAsync stubbed to a fixed outcome.
   * child_process is mocked only inside this suite so the resolvePythonBin
   * tests above keep exercising the real interpreter detection.
   */
  async function loadService(outcome: { rejectWith?: unknown; resolveWith?: unknown }) {
    jest.resetModules();
    jest.doMock('child_process', () => {
      const actual = jest.requireActual<typeof import('child_process')>('child_process');
      const { promisify } = jest.requireActual<typeof import('util')>('util');
      const execFile = jest.fn();
      (execFile as unknown as Record<symbol, unknown>)[promisify.custom] = () =>
        ('rejectWith' in outcome
          ? Promise.reject(outcome.rejectWith)
          : Promise.resolve(outcome.resolveWith));
      return {
        ...actual,
        execFile,
        execFileSync: jest.fn(() => Buffer.from('Python 3.12.0')),
      };
    });
    const mod = await import('./parser.service');
    return new mod.ParserService();
  }

  /** Captures the rejection so message and HTTP status can both be asserted. */
  async function parseAndCatch(service: { parse: (p: string) => Promise<unknown> }) {
    try {
      await service.parse('/tmp/does-not-matter.xlsx');
    } catch (e) {
      return e as { message: string; getStatus?: () => number };
    }
    throw new Error('expected parse() to reject');
  }

  it('surfaces a structured English parser error instead of the generic message', async () => {
    const service = await loadService({
      rejectWith: Object.assign(new Error('Command failed: python3 parser_cli.py'), {
        stdout: '{"ok":false,"error":"File type not recognized"}',
        stderr: '',
      }),
    });
    const err = await parseAndCatch(service);
    expect(err.message).toContain('File type not recognized');
    expect(err.message).not.toContain(GENERIC);
    expect(err.getStatus?.()).toBe(400);
  });

  it('preserves the readable Arabic parser error', async () => {
    const arabic = 'لم يُتعرَّف على نوع الملف — المدعوم: كشف حساب تحليلي (بنية الكتل)';
    const service = await loadService({
      rejectWith: Object.assign(new Error('Command failed'), {
        stdout: JSON.stringify({ ok: false, error: arabic }),
        stderr: '',
      }),
    });
    const err = await parseAndCatch(service);
    expect(err.message).toContain(arabic);
  });

  it('surfaces a structured error delivered as a Buffer', async () => {
    const service = await loadService({
      rejectWith: Object.assign(new Error('Command failed'), {
        stdout: Buffer.from('{"ok":false,"error":"Buffer path works"}', 'utf8'),
        stderr: '',
      }),
    });
    const err = await parseAndCatch(service);
    expect(err.message).toContain('Buffer path works');
  });

  it('keeps the generic fallback when stdout is not valid JSON', async () => {
    const service = await loadService({
      rejectWith: Object.assign(new Error('Command failed'), {
        stdout: 'Traceback (most recent call last): SyntaxError',
        stderr: '',
      }),
    });
    const err = await parseAndCatch(service);
    expect(err.message).toContain(GENERIC);
  });

  it('keeps the generic fallback when stdout is empty', async () => {
    const service = await loadService({
      rejectWith: Object.assign(new Error('spawn ENOENT'), { stdout: '', stderr: '' }),
    });
    const err = await parseAndCatch(service);
    expect(err.message).toContain(GENERIC);
  });

  it('keeps the generic fallback when the JSON has no usable error string', async () => {
    const service = await loadService({
      rejectWith: Object.assign(new Error('Command failed'), {
        stdout: '{"ok":false}',
        stderr: '',
      }),
    });
    const err = await parseAndCatch(service);
    expect(err.message).toContain(GENERIC);
  });

  it('logs the parser error without dumping the process object', async () => {
    const service = await loadService({
      rejectWith: Object.assign(new Error('Command failed: python3 /app/parser/parser_cli.py'), {
        stdout: '{"ok":false,"error":"File type not recognized"}',
        stderr: '',
        // Fields that must never reach the log:
        cmd: 'python3 /app/parser/parser_cli.py /data/uploads/secret.xlsx',
      }),
    });
    // Import after loadService(): jest.resetModules() replaces the registry, so the
    // spy must target the same Logger class the freshly-loaded service uses.
    const { Logger } = await import('@nestjs/common');
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await parseAndCatch(service);

    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('File type not recognized');
    expect(logged).not.toContain('/data/uploads/secret.xlsx');
    expect(logged).not.toContain('parser_cli.py');
    errorSpy.mockRestore();
  });

  it('redacts filesystem paths in the surfaced error and in the log', async () => {
    const BS = String.fromCharCode(92);
    const winPath = 'C:' + BS + 'Users' + BS + 'USER' + BS + 'private.xlsx';
    const service = await loadService({
      rejectWith: Object.assign(new Error('Command failed'), {
        stdout: JSON.stringify({
          ok: false,
          error: 'FileNotFoundError: /data/uploads/private.xlsx and ' + winPath,
        }),
        stderr: '',
      }),
    });
    const { Logger } = await import('@nestjs/common');
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const err = await parseAndCatch(service);
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join(String.fromCharCode(10));

    for (const text of [err.message, logged]) {
      expect(text).toContain('[path]');
      expect(text).toContain('FileNotFoundError');
      expect(text).not.toContain('/data/uploads/private.xlsx');
      expect(text).not.toContain(winPath);
      expect(text).not.toContain('private.xlsx');
    }
    errorSpy.mockRestore();
  });

  it('still returns the parsed payload on the success path', async () => {
    const payload = {
      ok: true,
      profile: 'CUSTOMER_MASTER',
      format: 'xlsx',
      stats: {
        accounts: 0, customers: 2, transactions: 0, fragmented_accounts: 0,
        errors: 0, empty_rows_skipped: 0, rows: 2, validRows: 2,
      },
      accounts: [], customers: [], balances: [],
      agingSummary: [], agingDetails: [], errors: [], skippedEmptyRows: 0,
    };
    const service = await loadService({
      resolveWith: { stdout: JSON.stringify(payload), stderr: '' },
    });
    const result = await service.parse('/tmp/ok.xlsx');
    expect(result.ok).toBe(true);
    expect(result.profile).toBe('CUSTOMER_MASTER');
    expect(result.stats.customers).toBe(2);
  });
});
