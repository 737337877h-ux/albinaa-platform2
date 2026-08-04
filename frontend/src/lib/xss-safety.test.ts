import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
  });
}

describe('XSS-safe rendering policy', () => {
  it('never renders application or imported data as raw HTML', () => {
    const files = sourceFiles(join(process.cwd(), 'src'));
    const unsafe = files
      .filter((file) => !/\.(test|spec)\.[jt]sx?$/.test(file))
      .filter((file) => /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML/.test(readFileSync(file, 'utf8')));
    expect(unsafe).toEqual([]);
  });
});
