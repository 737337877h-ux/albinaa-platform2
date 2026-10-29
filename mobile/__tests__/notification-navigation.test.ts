import {describe,test,expect} from '@jest/globals';
import {notificationNavigationTarget as target} from '../src/utils/notification-navigation';
describe('notification destinations',()=>{
 test.each(['assigned','returned','completed','cancelled'])('HR task %s opens employee work, never collection tasks',event=>expect(target('hr_task_'+event,{taskId:'t',assignmentId:'a'})).toEqual({route:'HrTasks',params:{taskId:'t',assignmentId:'a'}}));
 test('submission opens the manager review screen',()=>expect(target('hr_task_submitted',{taskId:'t',assignmentId:'a',reviewerEvent:true}).route).toBe('HrTaskReview'));
 test.each(['advance','leave'])('request %s routes reviewer and employee separately',requestKind=>{expect(target('hr_request_submitted',{requestKind,reviewerEvent:true}).route).toBe('HrRequestReview');expect(target('hr_request_decided',{requestKind,reviewerEvent:false}).route).toBe('HrRequests');});
 test.each(['task_new','task_overdue'])('collection %s stays in collection tasks',kind=>expect(target(kind,{taskId:'t'}).route).toBe('Main'));
 test.each([['collection_created','CollectionsList'],['receipt_uploaded','CollectionsList'],['promise_due','PromisesList'],['promise_overdue','PromisesList'],['followup_due','FollowupsList'],['sync_failed','Settings'],['scheduled_job_failed','Settings'],['finance_alert','Notifications']])('%s opens %s',(kind,route)=>expect(target(kind).route).toBe(route));
 test('customer-linked events use the exact customer identifier',()=>expect(target('customer_transferred',{customerId:'c'})).toEqual({route:'Customer360',params:{id:'c'}}));
 test('handles local task reminder navigation',()=>expect(target('',{route:'Tasks'}).route).toBe('Main'));
});
