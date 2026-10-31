import {MobileService} from './mobile.service';

describe('mobile sync without collector assignment', () => {
  function setup(collectorId: string | null = null) {
    const prisma: any = {};
    for (const name of ['task','customer','followup','paymentPromise','collection','auditLog','reservation','currency','collectionMethod','followupType','followupResult','unit']) {
      prisma[name] = {findMany: jest.fn().mockResolvedValue([])};
    }
    prisma.collector = {findUnique: jest.fn().mockResolvedValue(collectorId ? {id:collectorId} : null)};
    prisma.oracleMovementSyncRun = { findFirst: jest.fn().mockResolvedValue(null) };
    const service = new MobileService(prisma);
    jest.spyOn(service, 'findCustomers').mockResolvedValue([]);
    return {prisma, service};
  }
  const permissions=['mobile.tasks.view','mobile.customers.view','mobile.followups.view','mobile.promises.view','mobile.collections.view','mobile.reservations.view'];
  const user:any={id:'user',organizationId:'org',permissions};
  it('returns a valid empty restricted snapshot without invalid UUID placeholders',async()=>{
    const {prisma,service}=setup();
    const result=await service.sync(user);
    expect(result.promises).toEqual([]);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
    for(const name of ['followup','paymentPromise','collection']) expect(prisma[name].findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:{in:[]}})}));
    expect(prisma.reservation.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({customer:expect.objectContaining({organizationId:'org',id:{in:[]}})})}));
  });
  it('retains collector scoping',async()=>{
    const {prisma,service}=setup('collector');await service.sync(user);
    expect(prisma.paymentPromise.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{collectorId:'collector'}}));
    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({assignedTo:'collector',customer:{organizationId:'org'}})}));
  });
  it('checks the catalog revision even after a recent general sync and retains the supplied version', async () => {
    const { service } = setup();
    const inventory = {
      offlineReferenceCatalog: jest.fn().mockResolvedValue({ catalogVersion: 'new-catalog', warehouses: [], items: [{ externalItemCode: 'i', nameAr: 'New name' }] }),
      summary: jest.fn().mockResolvedValue(null),
    };
    (service as any).oracleInventory = inventory;
    const result = await service.sync({ ...user, permissions: ['mobile.inventory.view'] }, new Date().toISOString(), true, false, 'old-catalog');
    expect(inventory.offlineReferenceCatalog).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org' }), 'IAS20261', 'old-catalog');
    expect(result.inventoryCatalogVersion).toBe('new-catalog');
    expect(result.references.oracleItems?.[0].nameAr).toBe('New name');
  });
  it('retains organization-wide access only for explicitly permitted users',async()=>{
    const {prisma,service}=setup();await service.sync({...user,permissions:[...permissions,'customers.read_all']});
    expect(prisma.paymentPromise.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{customer:{organizationId:'org'}}}));
  });
  it('syncs all scoped reservations in collector mode and still requires permission',async()=>{
    const {prisma,service}=setup('collector');await service.sync(user,undefined,false,true);
    const query=prisma.reservation.findMany.mock.calls[0][0];
    expect(query.where.customer).toEqual({organizationId:'org',status:'active',assignments:{some:{collectorId:'collector',effectiveTo:null}}});
    expect(query.take).toBeUndefined();
    prisma.reservation.findMany.mockClear();await service.sync({...user,permissions:['mobile.tasks.view']},undefined,false,true);
    expect(prisma.reservation.findMany).not.toHaveBeenCalled();
  });

});
