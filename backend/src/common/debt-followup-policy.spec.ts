import { isActionableDebtorBalance } from './debt-followup-policy';

describe('debt follow-up policy', () => {
  it.each([
    [3_000, 'YER'], [3_000, 'YR'], [30, 'SAR'], [30, 'SR'], [5, 'USD'],
    [0, 'YER'], [-50, 'YER'],
  ])('excludes %s %s', (amount, currency) => {
    expect(isActionableDebtorBalance(amount as number, currency as string)).toBe(false);
  });

  it.each([
    [3_000.01, 'YER'], [30.01, 'SAR'], [5.01, 'USD'], [1, 'EUR'],
  ])('keeps %s %s', (amount, currency) => {
    expect(isActionableDebtorBalance(amount as number, currency as string)).toBe(true);
  });
});
