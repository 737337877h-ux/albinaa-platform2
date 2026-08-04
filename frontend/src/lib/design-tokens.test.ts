import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/app/globals.css', 'utf8');
const color = (name: string) => css.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1] ?? '';
const luminance = (hex: string) => {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const contrast = (foreground: string, background: string) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

describe('dark financial design tokens', () => {
  it.each([
    ['--text-hi', '--surface-0'], ['--text-hi', '--surface-2'],
    ['--text-mid', '--surface-0'], ['--text-mid', '--surface-1'],
    ['--gold', '--surface-1'], ['--brand', '--surface-0'],
  ])('%s meets WCAG AA on %s', (foreground, background) => {
    expect(contrast(color(foreground), color(background))).toBeGreaterThanOrEqual(4.5);
  });
});
