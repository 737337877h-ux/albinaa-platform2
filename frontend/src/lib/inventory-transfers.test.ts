import { describe, expect, it } from 'vitest';
import { oracleStateLabel, transferStatusTone } from './inventory-transfers';

describe('inventory transfer presentation', () => {
  it('shows completed only when both Oracle effects exist', () => {
    expect(oracleStateLabel(true, true, true)).toBe('مكتمل');
    expect(oracleStateLabel(true, false, false)).toBe('صادر ولم يُستلم');
    expect(oracleStateLabel(false, false, false)).toBe('لم يصدر بعد');
  });

  it('uses warning and success tones for workflow states', () => {
    expect(transferStatusTone('pending_approval')).toBe('hazard');
    expect(transferStatusTone('approved')).toBe('credit');
    expect(transferStatusTone('rejected')).toBe('debt');
  });
});
