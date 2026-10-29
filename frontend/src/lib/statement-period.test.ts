import { describe, expect, it } from 'vitest';
import { archiveStatementPeriodError } from './statement-period';
import { friendlyApiError } from './errors';
import { ApiError } from './api';

describe('archive statement period', () => {
  it.each([['',''],['2026-10-01',''],['','2026-10-26']])('requires both endpoints (%s to %s)', (from,to) => {
    expect(archiveStatementPeriodError('oracle_archive',from,to)).toContain('حدد');
  });
  it('allows a complete inclusive archive range and preserves optional platform filters', () => {
    expect(archiveStatementPeriodError('oracle_archive','2020-01-01','2026-12-31')).toBeNull();
    expect(archiveStatementPeriodError('platform','','')).toBeNull();
    expect(archiveStatementPeriodError('platform','2026-10-01','')).toBeNull();
  });
  it.each([['2026-10-26','2026-10-01'],['2019-12-31','2026-10-26'],['2026-01-01','2027-01-01'],['2026-02-30','2026-03-01']])('blocks invalid archive period %s to %s',(from,to)=>{
    expect(archiveStatementPeriodError('oracle_archive',from,to)).not.toBeNull();
  });
  it('shows only recognized archive validation guidance without exposing raw errors', () => {
    expect(friendlyApiError(new ApiError(400,'حدد بداية ونهاية الفترة للكشف التاريخي'))).toContain('الفترة');
    expect(friendlyApiError(new ApiError(400,'تجاوزت الفترة 5000 حركة؛ اختر فترة أقصر. سيشمل الرصيد الافتتاحي الحركات السابقة.'))).toContain('5000');
    expect(friendlyApiError(new ApiError(400,'ORA-00942 internal table detail'))).toBe('حدث خطأ غير متوقع. حاول مرة أخرى.');
    expect(friendlyApiError(new ApiError(500,'internal detail'))).not.toContain('internal detail');
  });
});
