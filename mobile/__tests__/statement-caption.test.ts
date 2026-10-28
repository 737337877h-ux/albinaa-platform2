import { describe, it, expect } from '@jest/globals';
import { statementCaption } from '../src/utils/statement-caption';

describe('user-approved statement caption', () => {
  it('uses the exact approved wording once', () => {
    const result = statementCaption('أحمد', '20029', '01-01-2026', '07-09-2026', 'YER');
    expect(result).toBe('الأخ/ أحمد، مرفق لكم كشف حسابكم رقم 20029 عن الفترة من 01-01-2026 إلى 07-09-2026 بعملة YER. نرجو مراجعة الكشف والتكرم بالسداد أو التواصل معنا عند وجود أي ملاحظة. البناء الراقي.');
    expect(result.match(/الأخ\//g)).toHaveLength(1);
  });
  it('uses only the selected account, period and currency', () => {
    const result = statementCaption('علي', '30876', '01-01-2025', '31-12-2025', 'SAR');
    expect(result).toContain('علي');
    expect(result).toContain('30876');
    expect(result).toContain('01-01-2025 إلى 31-12-2025 بعملة SAR');
    expect(result).not.toContain('20029');
  });
  it('does not invent an account number if absent', () => {
    expect(statementCaption('أحمد', undefined, '01-01-2026', '07-09-2026', 'USD')).toContain('رقم —');
  });
});
