import { ConfigService } from '@nestjs/config';
import { CustomerOrdersController } from './customer-orders.controller';
describe('CustomerOrdersController',()=>{
  const actor={id:'user',organizationId:'org',permissions:['sales_order_drafts.manage']} as any;
  const input={externalReference:'stable-reference',orderKind:'credit'};
  const mirror=jest.fn();
  const make=(enabled='true')=>new CustomerOrdersController(new ConfigService({
    ORACLE_SALES_ORDERS_ORGANIZATION_ID:'org',ORACLE_SALES_ORDERS_WRITE_ENABLED:enabled,
    ORACLE_SALES_ORDERS_WRITE_API_URL:'http://gateway',ORACLE_SALES_ORDERS_WRITE_API_KEY:'test',
  }),{mirrorCreatedOrder:mirror} as any);
  afterEach(()=>{jest.restoreAllMocks();mirror.mockReset();});
  it('rejects other organizations and disabled creation before contacting Oracle',async()=>{
    const fetch=jest.spyOn(global,'fetch');
    await expect(make().create({...actor,organizationId:'other'},input)).rejects.toThrow();
    await expect(make('false').create(actor,input)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('scopes stable references and recovers a previously saved order',async()=>{
    const fetch=jest.spyOn(global,'fetch').mockResolvedValue({ok:true,status:200,json:async()=>({schema:'IAS20261',serial:'2026000001532287',created:false})} as Response);
    mirror.mockResolvedValue({id:'draft-id',sourceSchema:'IAS20261'});
    expect(await make().create(actor,input)).toMatchObject({id:'draft-id',oracleCreated:false,oracleWrite:'SAVED'});
    expect(JSON.parse((fetch.mock.calls[0][1] as any).body).externalReference).toBe('org:stable-reference');
    expect(mirror).toHaveBeenCalledWith(actor,'2026000001532287');
  });
  it('preserves retryability when mirroring fails after Oracle saved',async()=>{
    jest.spyOn(global,'fetch').mockResolvedValue({ok:true,status:200,json:async()=>({schema:'IAS20261',serial:'2026000001532287',created:true})} as Response);
    mirror.mockRejectedValue(new Error('offline'));
    await expect(make().create(actor,input)).rejects.toMatchObject({status:503});
  });
  it('does not mirror during read-only validation',async()=>{
    jest.spyOn(global,'fetch').mockResolvedValue({ok:true,status:200,json:async()=>({schema:'IAS20261',mode:'DRY_RUN',oracleWrite:'NONE',valid:true})} as Response);
    await make().preview(actor,input);
    expect(mirror).not.toHaveBeenCalled();
  });
});
