import {canUseMobileFeature} from './mobile-permissions';
import {isOperationsApp} from '../config/product';
import {canOpenOperationsRoute, operationsDocumentKinds} from './operations-access';

export const collectorRoutes = [
  'Reservations','NewReservation','Main','Profile','Settings','Notifications','Customer360','NewFollowup','NewPromise',
  'NewCollection','FollowupsList','CollectionsList','NewTask','UploadReceipt',
  'CustomerLocationPicker','MessageTemplates','PromisesList','DebtChangeDetails',
  'RequestCenter','RequestVoucher','RequestJournal','AssignTask','CollectionKpi',
  'ManageUsers','ManageRoles','ManageCollectors','ManageAssignments',
  'HrCenter','HrAttendance','HrRequests','HrTasks','HrMyPayroll',
] as const;
export function canOpenCollectorRoute(route:string):boolean {
  return (collectorRoutes as readonly string[]).includes(route);
}
export function canOpenAppRoute(route:string,permissions:readonly string[]):boolean {
  if(isOperationsApp)return canOpenOperationsRoute(route,permissions);
  if(route==='Reservations')return canUseMobileFeature(permissions,'mobile.reservations.view','reservations.read');
  if(route==='NewReservation')return canUseMobileFeature(permissions,'mobile.reservations.create','reservations.create');
  return canOpenCollectorRoute(route);
}
export function isAppDocument(kind:string):boolean {
  return isOperationsApp ? operationsDocumentKinds.includes(kind) : ['receipt','payment','journal'].includes(kind);
}
