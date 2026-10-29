import { pushDevicesForKind, pushSoundForDevice } from './push-application';
describe('push app isolation', () => {
  const collector={id:'old',applicationId:'com.albinaa.collector'}, operations={id:'new',applicationId:'com.alraqi.operations'};
  it('uses the supplied sound only after the Operations device registers its channel',()=>{
    expect(pushSoundForDevice({...operations,notificationChannelId:'alraqi-operations-sms-v1'})).toEqual({channelId:'alraqi-operations-sms-v1',sound:'alraqi_sms.m4a'});
    for(const device of [operations,collector,{...collector,notificationChannelId:'alraqi-operations-sms-v1'}]) expect(pushSoundForDevice(device)).toEqual({channelId:'albinaa-reminders',sound:'default'});
  });
  it('keeps finance alerts and assignments out of Operations',()=>{
    for(const kind of ['finance_alert','customer_transferred','promise_due','collection_created']) expect(pushDevicesForKind(kind,[collector,operations])).toEqual([collector]);
  });
  it('routes shared HR to Operations when available, and falls back for existing users',()=>{
    expect(pushDevicesForKind('hr_task_assigned',[collector,operations])).toEqual([operations]);
    expect(pushDevicesForKind('hr_leave_reviewed',[collector])).toEqual([collector]);
  });
  it('routes specialized operations and review alerts only to Operations',()=>{
    for(const kind of ['sales_order_created','quotation_created','inventory_transfer_created','purchase_created']) expect(pushDevicesForKind(kind,[collector,operations])).toEqual([operations]);
    expect(pushDevicesForKind('hr_task_submitted',[collector,operations],{reviewerEvent:true})).toEqual([operations]);
    expect(pushDevicesForKind('sales_order_created',[collector])).toEqual([]);
  });
  it('uses the payment tone exclusively for collection_created on updated collector devices',()=>{
    const updated={...collector,notificationChannelId:'albinaa-collection-created-v1'};
    expect(pushSoundForDevice(updated,'collection_created')).toEqual({channelId:'albinaa-collection-created-v1',sound:'collection_success.mp3'});
    for(const kind of ['receipt_uploaded','collection_reversal_requested','promise_due','hr_task_assigned','finance_alert']) expect(pushSoundForDevice(updated,kind)).toEqual({channelId:'albinaa-reminders',sound:'default'});
    expect(pushSoundForDevice(collector,'collection_created')).toEqual({channelId:'albinaa-reminders',sound:'default'});
  });
});
