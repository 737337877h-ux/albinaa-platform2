import {expect,it} from '@jest/globals';
import {hasNoRecordedFollowup,customerEngagementIds} from '../src/utils/customer';
it('keeps promised/collected accounts with no followup and excludes all-history followups',()=>{
 expect(hasNoRecordedFollowup({id:'promise',hasRecordedEngagement:1,hasRecordedFollowup:0},new Set())).toBe(true);
 expect(hasNoRecordedFollowup({id:'collection',hasRecordedEngagement:1,hasRecordedFollowup:false},new Set())).toBe(true);
 expect(hasNoRecordedFollowup({id:'old',hasRecordedFollowup:1},new Set())).toBe(false);
});
it('removes an account immediately after a locally saved followup including no answer',()=>{
 const ids=customerEngagementIds([{customerId:'a',result:'no_answer'}]);
 expect(hasNoRecordedFollowup({id:'a',hasRecordedFollowup:0},ids)).toBe(false);
});
it('does not confuse a pre-upgrade snapshot with a confirmed absence of followups',()=>{
 expect(hasNoRecordedFollowup({id:'a'},new Set())).toBe(false);
 expect(hasNoRecordedFollowup({id:'a',hasRecordedFollowup:null},new Set())).toBe(false);
});
