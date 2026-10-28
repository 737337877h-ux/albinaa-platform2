import { canUseMobileFeature } from './mobile-permissions';

// Explicit route registry: a collection notification must never open a balance
// screen in the operations app. API authorization remains on the server.
export const operationsRoutes = [
  'Main', 'Settings', 'Notifications', 'RequestCenter', 'Quotations', 'NewQuotation',
  'CustomerOrders', 'NewCustomerOrder', 'RequestPurchase', 'RequestInventoryTransfer',
  'NewInventoryCount', 'Inventory', 'InventoryItem', 'Reservations', 'NewReservation',
  'HrCenter', 'HrAttendance', 'HrRequests', 'HrTasks', 'HrTaskReview', 'HrRequestReview', 'HrMyPayroll',
  'AssignHrTask', 'BarcodeDesign', 'ManageUsers', 'ManageRoles',
] as const;
export function canOpenOperationsRoute(route: string, permissions: readonly string[]): boolean {
  if (!(operationsRoutes as readonly string[]).includes(route)) return false;
  const any = (...codes: string[]) => codes.some(p => permissions.includes(p));
  if (['Main', 'Settings', 'Notifications', 'HrCenter', 'HrAttendance', 'HrRequests', 'HrTasks', 'HrMyPayroll'].includes(route)) return true;
  if (['Quotations', 'CustomerOrders'].includes(route)) return any('sales_order_drafts.read');
  if (['NewQuotation', 'NewCustomerOrder'].includes(route)) return any('sales_order_drafts.manage');
  if (route === 'RequestPurchase') return any('oracle_test_requests.purchase.create');
  if (route === 'RequestInventoryTransfer') return any('inventory_transfers.create');
  if (route === 'NewInventoryCount') return any('oracle_test_requests.inventory_count.create', 'mobile.inventory_count.create');
  if (route === 'Inventory' || route === 'InventoryItem') return canUseMobileFeature(permissions, 'mobile.inventory.view', 'reports.read');
  if (route === 'Reservations') return canUseMobileFeature(permissions, 'mobile.reservations.view', 'reservations.read');
  if (route === 'NewReservation') return canUseMobileFeature(permissions, 'mobile.reservations.create', 'reservations.create');
  if (route === 'BarcodeDesign') return any('inventory.read');
  if (route === 'AssignHrTask' || route === 'HrTaskReview') return any('hr.tasks.manage');
  if (route === 'HrRequestReview') return any('hr.requests.review');
  if (route === 'ManageUsers' || route === 'ManageRoles') return any('users.manage');
  if (route === 'RequestCenter') return ['Quotations', 'NewQuotation', 'RequestPurchase', 'RequestInventoryTransfer', 'NewInventoryCount'].some(r => canOpenOperationsRoute(r, permissions));
  return false;
}

export const operationsDocumentKinds = ['customer_order', 'quotation', 'purchase', 'inventory_transfer', 'inventory_count'];
export function isOperationsNotification(kind: string): boolean {
  return kind.startsWith('hr_') || kind.startsWith('inventory_') || kind.startsWith('quotation_')
    || kind.startsWith('sales_order_') || kind.startsWith('purchase_') || kind === 'sync_failed';
}
