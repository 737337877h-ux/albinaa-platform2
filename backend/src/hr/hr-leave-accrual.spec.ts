import {leaveBalance} from './hr-profile.service';
import {DEFAULT_TIME_RULE} from './hr-time-policy';
const days=[0,1,2,3,4,6];
const context=(now:string,policy:any={})=>({now:new Date(now),policy,payrollStart:'2026-10-01'});
describe('monthly leave accrual',()=>{
 it('does not invent historical balance or credit an incomplete month',()=>{
  expect(leaveBalance({},[],days,context('2026-10-20'))).toMatchObject({opening:null,openingKnown:false,accrued:0,remaining:0});
  expect(leaveBalance({},[],days,context('2026-10-31T21:00:00Z'))).toMatchObject({accrued:2.5,remaining:2.5});
 });
 it('uses effective monthly rates without changing earlier months',()=>{
  const policy={payrollRules:[{...DEFAULT_TIME_RULE,effectiveFrom:'2026-11-01',monthlyLeaveDays:3}]};
  expect(leaveBalance({},[],days,context('2026-12-01',policy))).toMatchObject({accrued:5.5});
 });
 it('counts approved annual leave once and separates future reservations',()=>{
  const r={kind:'leave',status:'approved',leaveType:'annual',startDate:'2026-10-01',endDate:'2026-10-03'};
  expect(leaveBalance({},[r,r,{...r,startDate:'2026-11-02',endDate:'2026-11-02'}],days,context('2026-11-01'))).toMatchObject({usedDays:2,futureReservedDays:1,accrued:2.5,remaining:-0.5});
 });
 it('treats manual opening as a dated balance and does not accrue twice before it',()=>{
  expect(leaveBalance({leaveOpeningDays:'10',leaveAsOf:'2026-11-01'},[],days,context('2026-12-01'))).toMatchObject({opening:10,accrued:2.5,remaining:12.5});
 });
});

it('starts a new leave balance in November without rewriting October or later manual opening',()=>{
 const profile={payrollResetFrom:'2026-11-01',leaveOpeningDays:10,leaveAsOf:'2026-10-01'};
 expect(leaveBalance(profile,[],days,context('2026-10-20'))).toMatchObject({remaining:10});
 expect(leaveBalance(profile,[],days,context('2026-11-01'))).toMatchObject({opening:0,remaining:0,asOf:'2026-11-01'});
 expect(leaveBalance(profile,[],days,context('2026-12-01'))).toMatchObject({accrued:2.5,remaining:2.5});
 expect(leaveBalance({...profile,leaveAsOf:'2026-11-01',leaveOpeningDays:7},[],days,context('2026-12-01'))).toMatchObject({remaining:9.5});
});
