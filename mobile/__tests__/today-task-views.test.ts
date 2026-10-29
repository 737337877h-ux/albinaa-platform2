import {expect,it} from '@jest/globals';
import {todayTaskViews} from '../src/utils/tasks';
it('preserves both categories before deduplication and decorates shared accounts in every view',()=>{
 const base={dueDate:'2026-09-28',status:'open'};
 const rows=[
  {...base,id:'m1',customerId:'shared',taskType:'followup_due',priorityReason:'موعد'},
  {...base,id:'a1',customerId:'shared',taskType:'risk_high',priorityReason:'مخاطر'},
  {...base,id:'a2',customerId:'automatic',taskType:'followup_normal'},
  {...base,id:'m2',customerId:'manual',taskType:'visit'},
  {...base,id:'future',customerId:'future',taskType:'visit',dueDate:'2026-09-30'},
  {...base,id:'done',customerId:'done',taskType:'visit',status:'done'},
 ];
 const views=todayTaskViews(rows,'2026-09-28');
 expect(views.all).toHaveLength(3);expect(views.manual).toHaveLength(2);expect(views.automatic).toHaveLength(2);
 expect(views.manual.find(t=>t.customerId==='shared')).toMatchObject({id:'m1',hasManual:true,hasAutomatic:true,manualReason:'موعد',automaticReason:'مخاطر'});
 expect(views.all.filter(t=>t.customerId==='shared')).toHaveLength(1);
 expect(views.automatic.find(t=>t.customerId==='automatic')).toMatchObject({hasManual:false,hasAutomatic:true});
 expect(todayTaskViews(rows,'2026-09-28','m1').all.find(t=>t.customerId==='shared')?.id).toBe('m1');
});
it('classifies the actual SQLite snapshot priority/title fields and keeps both sources',()=>{
 const views=todayTaskViews([
  {id:'auto',customerId:'a',priority:'followup_normal',title:'سبب تلقائي',dueDate:'2026-09-28',status:'open'},
  {id:'manual',customerId:'a',priority:'followup_due',title:'موعد متفق عليه',dueDate:'2026-09-28',status:'open'},
 ],'2026-09-28');
 expect(views.all).toHaveLength(1);expect(views.manual).toHaveLength(1);expect(views.automatic).toHaveLength(1);
 expect(views.all[0]).toMatchObject({hasManual:true,hasAutomatic:true,manualReason:'موعد متفق عليه',automaticReason:'سبب تلقائي'});
});
