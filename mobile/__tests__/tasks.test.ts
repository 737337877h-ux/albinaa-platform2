import { describe, expect, it } from '@jest/globals';
import { collapseTasksByCustomer } from '../src/utils/tasks';

describe('collapseTasksByCustomer', () => {
  it('shows every customer once and keeps the most important task', () => {
    const result = collapseTasksByCustomer([
      { id: 'normal', customerId: 'c1', taskType: 'followup_normal', dueDate: '2026-08-16' },
      { id: 'high', customerId: 'c1', taskType: 'high_balance_no_followup', dueDate: '2026-08-12' },
      { id: 'c2', customerId: 'c2', taskType: 'followup_normal', dueDate: '2026-08-16' },
    ]);

    expect(result.map((task) => task.id)).toEqual(['high', 'c2']);
  });

  it('keeps the task opened from a notification when it belongs to a duplicate customer', () => {
    const result = collapseTasksByCustomer([
      { id: 'high', customerId: 'c1', taskType: 'high_balance_no_followup', dueDate: '2026-08-16' },
      { id: 'focused', customerId: 'c1', taskType: 'followup_normal', dueDate: '2026-08-16' },
    ], 'focused');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('focused');
  });
});
