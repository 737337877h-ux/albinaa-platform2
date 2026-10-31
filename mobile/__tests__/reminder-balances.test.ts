import { describe, it, expect } from '@jest/globals';
import { reminderBalanceText } from '../src/utils/reminder-balances';

describe('payment reminder currencies', () => {
  it('includes debts in both currencies without comparing their nominal amounts', () => {
    expect(reminderBalanceText([
      { balance: 80000, currency: 'YER' }, { balance: 1500.25, currency: 'SAR' },
    ])).toEqual({ balance: '80,000 ريال يمني، 1,500.25 ريال سعودي', currency: '', summary: '80,000 ريال يمني، 1,500.25 ريال سعودي' });
  });
  it('supports offline accounting rows and currency aliases', () => {
    expect(reminderBalanceText([{ operationalBalance: 20, accountingBalance: 50, currencyCode: 'SR' }]).balance).toBe('20');
    expect(reminderBalanceText([{ accountingBalance: '25', currency: { code: 'USD' } }]).currency).toBe('دولار أمريكي');
  });
  it('never treats credit as debt or nets different currencies', () => {
    const result = reminderBalanceText([{ balance: -500, currency: 'YER' }, { balance: 10, currency: 'SAR' }, { balance: 0, currency: 'USD' }]);
    expect(result.summary).toBe('10 ريال سعودي');
  });
  it('keeps small positive debts and combines only the same currency', () => {
    expect(reminderBalanceText([{ balance: 1, currency: 'YR' }, { balance: 2, currency: 'YER' }, { balance: 3, currency: 'SR' }]).summary).toBe('3 ريال يمني، 3 ريال سعودي');
  });
  it('ignores invalid values without mutating source data', () => {
    const rows = [{ balance: 'invalid', currency: 'YER' }, { balance: 5, currency: 'SAR' }];
    expect(reminderBalanceText(rows).summary).toBe('5 ريال سعودي');
    expect(rows[0].balance).toBe('invalid');
  });
});
