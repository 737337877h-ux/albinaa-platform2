import {of,lastValueFrom} from 'rxjs';
import {IdempotencyInterceptor} from './idempotency.interceptor';
describe('new user-scoped idempotency without invalidating legacy queues',()=>{
 it.each([true,'user'])('uses the requested scope %s',async scope=>{
  const findUnique=jest.fn().mockResolvedValue({response:{alreadySent:true}});
  const interceptor=new IdempotencyInterceptor({getAllAndOverride:()=>scope} as any,{idempotencyKey:{findUnique}} as any);
  const request={method:'POST',path:'/employee-messages/broadcast',headers:{'idempotency-key':'op1'},user:{id:'u1',organizationId:'org1'}};
  const context={getHandler:()=>null,getClass:()=>null,switchToHttp:()=>({getRequest:()=>request,getResponse:()=>({setHeader:jest.fn()})})} as any;
  await lastValueFrom(interceptor.intercept(context,{handle:()=>of({})}));
  expect(findUnique).toHaveBeenCalledWith({where:{key:`${scope==='user'?'org1:u1:':''}POST:/employee-messages/broadcast:op1`}});
 });
});
