import {describe,it,expect} from '@jest/globals';
import {contactReturn} from '../src/utils/contact-return';

describe('returning from customer communication',()=>{
 const attempt={customerId:'c1',channel:'call',leftApp:false};
 it('asks for a result only after leaving and returning, once',()=>{
  expect(contactReturn(attempt,'active','active','c1').channel).toBeNull();
  const left=contactReturn(attempt,'background','active','c1');
  const returned=contactReturn(left.pending,'active','background','c1');
  expect(returned).toEqual({pending:null,channel:'call'});
  expect(contactReturn(returned.pending,'active','inactive','c1').channel).toBeNull();
 });
 it('does not attach an old call to another customer',()=>expect(contactReturn({...attempt,leftApp:true},'active','background','c2')).toEqual({pending:null,channel:null}));
 it.each(['sms','whatsapp'])('collects the actual outcome after %s without assuming delivery',channel=>{
  expect(contactReturn({...attempt,channel,leftApp:true},'active','inactive','c1').channel).toBe(channel);
 });
 it('does not show a result without a recorded attempt',()=>expect(contactReturn(null,'active','background','c1').channel).toBeNull());
});
