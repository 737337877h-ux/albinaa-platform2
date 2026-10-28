import { describe, expect, test } from '@jest/globals';
import { canOpenOperationsRoute, isOperationsNotification } from '../src/utils/operations-access';

describe('operations application boundary', () => {
  const admin = ['customers.read_all', 'customers.read', 'balances.read', 'tasks.manage', 'users.manage', 'collections.create', 'sales_order_drafts.manage', 'sales_order_drafts.read', 'inventory_transfers.create', 'oracle_test_requests.inventory_count.create'];
  test.each(['Customer360', 'CollectionsList', 'NewCollection', 'AssignTask', 'CollectionKpi', 'ManageCollectors', 'ManageAssignments', 'RequestVoucher'])('never exposes collection route %s even to an administrator', route => {
    expect(canOpenOperationsRoute(route, admin)).toBe(false);
  });
  test('preserves create vs read permissions and always provides personal employee services', () => {
    expect(canOpenOperationsRoute('NewQuotation', ['sales_order_drafts.read'])).toBe(false);
    expect(canOpenOperationsRoute('Quotations', ['sales_order_drafts.read'])).toBe(true);
    expect(canOpenOperationsRoute('NewQuotation', admin)).toBe(true);
    expect(canOpenOperationsRoute('HrAttendance', [])).toBe(true);
    expect(canOpenOperationsRoute('AssignHrTask', [])).toBe(false);
    expect(canOpenOperationsRoute('NewInventoryCount', ['mobile.inventory_count.create'])).toBe(true);
  });
  test('honors explicitly configured mobile inventory access', () => {
    expect(canOpenOperationsRoute('Inventory', ['mobile.tasks.view', 'reports.read'])).toBe(false);
    expect(canOpenOperationsRoute('Inventory', ['mobile.inventory.view'])).toBe(true);
  });
  test('separates collection and employee task notifications', () => {
    expect(isOperationsNotification('hr_task_assigned')).toBe(true);
    expect(isOperationsNotification('task_new')).toBe(false);
    expect(isOperationsNotification('collection_created')).toBe(false);
  });
});
