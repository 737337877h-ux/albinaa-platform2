import { TASK_TYPE_PRIORITY, priorityOfTaskType, queueTaskKey } from './tasks.service';

describe('daily work queue helpers (PR 5)', () => {
  describe('TASK_TYPE_PRIORITY', () => {
    it('ranks queue causes in owner-approved order 1..11', () => {
      const ordered = [
        'promise_overdue',
        'promise_due_today',
        'followup_overdue',
        'risk_critical',
        'risk_high',
        'debt_120plus',
        'high_balance_no_followup',
        'repeated_no_answer',
        'needs_visit',
        'followup_periodic_medium',
        'followup_normal',
      ];
      const values = ordered.map((t) => TASK_TYPE_PRIORITY[t]);
      expect([...new Set(values)].length).toBe(values.length);
      for (let i = 1; i < values.length; i += 1) {
        expect(values[i]).toBeGreaterThan(values[i - 1]);
      }
    });

    it('maps promise sweep task types to top priorities (1 and 2)', () => {
      expect(priorityOfTaskType('promise_escalation')).toBe(1);
      expect(priorityOfTaskType('promise_due')).toBe(2);
    });

    it('falls back to 100 for unknown task types', () => {
      expect(priorityOfTaskType('whatever')).toBe(100);
    });
  });

  describe('queueTaskKey (dedup guard)', () => {
    const today = new Date('2026-08-01T12:00:00Z');
    it('produces the approved 5-part key: customer + currency + type + date + source', () => {
      expect(queueTaskKey('c1', 'SAR', 'debt_120plus', today)).toBe('c1|SAR|debt_120plus|2026-08-01|');
    });
    it('distinguishes different sources', () => {
      expect(queueTaskKey('c1', 'SAR', 'promise_due', today, 'p1'))
        .toBe('c1|SAR|promise_due|2026-08-01|p1');
      expect(queueTaskKey('c1', 'SAR', 'promise_due', today, null)).not.toBe(
        queueTaskKey('c1', 'SAR', 'promise_due', today, 'p1'),
      );
    });
    it('is idempotent for a generated queue item (no source, customer-level)', () => {
      const a = queueTaskKey('c2', null, 'repeated_no_answer', today);
      const b = queueTaskKey('c2', null, 'repeated_no_answer', today);
      expect(a).toBe(b);
    });
    it('differs when currency or task type changes (no duplicate merge)', () => {
      const base = queueTaskKey('c1', 'SAR', 'debt_120plus', today);
      expect(queueTaskKey('c1', 'USD', 'debt_120plus', today)).not.toBe(base);
      expect(queueTaskKey('c1', 'SAR', 'risk_high', today)).not.toBe(base);
    });
  });
});
