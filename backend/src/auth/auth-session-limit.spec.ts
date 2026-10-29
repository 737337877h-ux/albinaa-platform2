import {AuthService} from './auth.service';

describe('session rotation capacity',()=>{
 const now=new Date();
 function setup(){
  const rows=Array.from({length:5},(_,i)=>({id:String(i),userId:'u',revokedAt:null,expiresAt:new Date(now.getTime()+3600000),createdAt:now}));
  rows.push({id:'expired',userId:'u',revokedAt:null,expiresAt:new Date(0),createdAt:now});
  const sessions={
   findMany:jest.fn(async({where}:any)=>rows.filter(r=>r.expiresAt>where.expiresAt.gt&&r.id!==where.id?.not)),
   create:jest.fn(async()=>({id:'new'})),update:jest.fn(),updateMany:jest.fn(),
  };
  const service=new AuthService({authSession:sessions} as any,{signAsync:async()=> 'access'} as any,{generateRefreshToken:()=> 'refresh'} as any,{} as any);
  return {service,sessions};
 }
 it('does not evict the other app when refreshing the fifth session',async()=>{
  const {service,sessions}=setup();await (service as any).issueTokens('u',undefined,'4');
  expect(sessions.updateMany).not.toHaveBeenCalled();
  expect(sessions.update).toHaveBeenCalledWith({where:{id:'4'},data:{revokedAt:expect.any(Date),replacedById:'new'}});
 });
 it('still enforces the limit on an additional login, ignoring expired sessions',async()=>{
  const {service,sessions}=setup();await (service as any).issueTokens('u');
  expect(sessions.updateMany).toHaveBeenCalledWith({where:{id:{in:['0']}},data:{revokedAt:expect.any(Date),replacedById:null}});
 });
});
