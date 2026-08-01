import {
  pointsForBalancePercentile,
  pointsForBrokenPromises,
  pointsForDaysSinceFollowup,
  pointsForDebtAge,
  pointsForGraceRequests,
  pointsForLastPaymentAge,
  pointsForNoAnswer,
  riskLevelOf,
} from './risk.service';

describe('risk scoring helpers', () => {
  describe('riskLevelOf', () => {
    it('maps approved score bands to risk levels', () => {
      expect(riskLevelOf(0)).toBe('low');
      expect(riskLevelOf(25)).toBe('low');
      expect(riskLevelOf(26)).toBe('medium');
      expect(riskLevelOf(50)).toBe('medium');
      expect(riskLevelOf(51)).toBe('high');
      expect(riskLevelOf(75)).toBe('high');
      expect(riskLevelOf(76)).toBe('critical');
      expect(riskLevelOf(100)).toBe('critical');
    });
  });

  describe('pointsForDebtAge (weight 25)', () => {
    it('gives 25 for any 120+ bucket amount', () => {
      expect(pointsForDebtAge({ b30: false, b60: false, b90: false, b120: false, b120Plus: true })).toBe(25);
    });
    it('gives 20 for 91-120, 15 for 61-90, 10 for 31-60, 5 for 0-30', () => {
      expect(pointsForDebtAge({ b30: true, b60: false, b90: false, b120: false, b120Plus: false })).toBe(5);
      expect(pointsForDebtAge({ b30: true, b60: true, b90: false, b120: false, b120Plus: false })).toBe(10);
      expect(pointsForDebtAge({ b30: true, b60: true, b90: true, b120: false, b120Plus: false })).toBe(15);
      expect(pointsForDebtAge({ b30: true, b60: true, b90: true, b120: true, b120Plus: false })).toBe(20);
    });
    it('gives 0 with no aging data', () => {
      expect(pointsForDebtAge({ b30: false, b60: false, b90: false, b120: false, b120Plus: false })).toBe(0);
    });
  });

  describe('pointsForBalancePercentile (weight 20)', () => {
    it('tiers by percentile within the currency', () => {
      expect(pointsForBalancePercentile(95)).toBe(20);
      expect(pointsForBalancePercentile(90)).toBe(20);
      expect(pointsForBalancePercentile(80)).toBe(15);
      expect(pointsForBalancePercentile(75)).toBe(15);
      expect(pointsForBalancePercentile(60)).toBe(10);
      expect(pointsForBalancePercentile(50)).toBe(10);
      expect(pointsForBalancePercentile(10)).toBe(5);
      expect(pointsForBalancePercentile(0)).toBe(5);
    });
  });

  describe('pointsForLastPaymentAge (weight 15)', () => {
    it('gives 15 for 90+ days, 12 for 60+, 8 for 30+, 4 for any, 1 for today', () => {
      expect(pointsForLastPaymentAge(90)).toBe(15);
      expect(pointsForLastPaymentAge(120)).toBe(15);
      expect(pointsForLastPaymentAge(60)).toBe(12);
      expect(pointsForLastPaymentAge(45)).toBe(8);
      expect(pointsForLastPaymentAge(30)).toBe(8);
      expect(pointsForLastPaymentAge(10)).toBe(4);
      expect(pointsForLastPaymentAge(1)).toBe(4);
      expect(pointsForLastPaymentAge(0)).toBe(1);
    });
    it('gives 0 when no payment is recorded', () => {
      expect(pointsForLastPaymentAge(null)).toBe(0);
    });
  });

  describe('pointsForBrokenPromises (weight 15)', () => {
    it('tiers by count', () => {
      expect(pointsForBrokenPromises(0)).toBe(0);
      expect(pointsForBrokenPromises(1)).toBe(8);
      expect(pointsForBrokenPromises(2)).toBe(8);
      expect(pointsForBrokenPromises(3)).toBe(12);
      expect(pointsForBrokenPromises(4)).toBe(12);
      expect(pointsForBrokenPromises(5)).toBe(15);
      expect(pointsForBrokenPromises(9)).toBe(15);
    });
  });

  describe('pointsForNoAnswer (weight 10)', () => {
    it('tiers by count', () => {
      expect(pointsForNoAnswer(0)).toBe(0);
      expect(pointsForNoAnswer(1)).toBe(5);
      expect(pointsForNoAnswer(2)).toBe(5);
      expect(pointsForNoAnswer(3)).toBe(8);
      expect(pointsForNoAnswer(4)).toBe(8);
      expect(pointsForNoAnswer(5)).toBe(10);
      expect(pointsForNoAnswer(8)).toBe(10);
    });
  });

  describe('pointsForDaysSinceFollowup (weight 10)', () => {
    it('gives 10 for >30, 7 for >14, 4 for >7, 1 otherwise', () => {
      expect(pointsForDaysSinceFollowup(60)).toBe(10);
      expect(pointsForDaysSinceFollowup(31)).toBe(10);
      expect(pointsForDaysSinceFollowup(30)).toBe(7);
      expect(pointsForDaysSinceFollowup(15)).toBe(7);
      expect(pointsForDaysSinceFollowup(14)).toBe(4);
      expect(pointsForDaysSinceFollowup(8)).toBe(4);
      expect(pointsForDaysSinceFollowup(7)).toBe(1);
      expect(pointsForDaysSinceFollowup(0)).toBe(1);
    });
    it('gives 0 when no followup is recorded', () => {
      expect(pointsForDaysSinceFollowup(null)).toBe(0);
    });
  });

  describe('pointsForGraceRequests (weight 5)', () => {
    it('tiers by count', () => {
      expect(pointsForGraceRequests(0)).toBe(0);
      expect(pointsForGraceRequests(1)).toBe(2);
      expect(pointsForGraceRequests(2)).toBe(4);
      expect(pointsForGraceRequests(3)).toBe(5);
      expect(pointsForGraceRequests(6)).toBe(5);
    });
  });
});
