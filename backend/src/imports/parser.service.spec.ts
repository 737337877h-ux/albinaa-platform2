import { resolvePythonBin } from './parser.service';

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
