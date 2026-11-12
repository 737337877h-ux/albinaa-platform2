import {Reflector} from '@nestjs/core';
import {PermissionsGuard} from '../common/guards/permissions.guard';
import {InventoryTransfersController} from './inventory-transfers.controller';
import {InventoryTransfersService} from './inventory-transfers.service';
const mobile='mobile.inventory_transfers.create',actor={id:'u1',organizationId:'org',permissions:[mobile],roles:[]} as any;
describe('mobile inventory-transfer authority',()=>{
 function authorize(method:keyof InventoryTransfersController,permissions:string[]){
  const context={getHandler:()=>InventoryTransfersController.prototype[method],getClass:()=>InventoryTransfersController,switchToHttp:()=>({getRequest:()=>({user:{...actor,permissions}})})} as any;
  return new PermissionsGuard(new Reflector()).canActivate(context);
 }
 it.each(['list','get','warehouseOptions','itemOptions','itemOption','create','submit','dryRun','refresh'] as const)('permits %s only with an accepted transfer capability',method=>{
  expect(authorize(method,[mobile])).toBe(true);expect(()=>authorize(method,[])).toThrow();
 });
 it.each(['approve','reject','linkOracleDocument'] as const)('never grants %s through the mobile create permission',method=>expect(()=>authorize(method,[mobile])).toThrow());
 function setup(){
  const db={inventoryTransferRequest:{findFirst:jest.fn().mockResolvedValue(null),findUnique:jest.fn(),update:jest.fn(),create:jest.fn()}},oracle={warehouseExists:jest.fn(),stock:jest.fn()},writer={createDraft:jest.fn()};
  return {db,oracle,writer,service:new InventoryTransfersService(db as any,{log:jest.fn()} as any,oracle as any,{} as any,writer as any)};
 }
 it('limits mobile-only read and submission to its organization and creator',async()=>{
  const {service,db,oracle,writer}=setup();
  await expect(service.get(actor,'other')).rejects.toThrow('غير موجود');
  await expect(service.submit(actor,'other',{} as any)).rejects.toThrow('غير موجود');
  await expect(service.dryRun(actor,'other')).rejects.toThrow('غير موجود');
  for(const call of db.inventoryTransferRequest.findFirst.mock.calls)expect(call[0].where).toEqual({id:'other',organizationId:'org',createdBy:'u1'});
  expect(oracle.stock).not.toHaveBeenCalled();expect(writer.createDraft).not.toHaveBeenCalled();
 });
 it('does not replay another creator request through an organization-wide creation key',async()=>{
  const {service,db}=setup();db.inventoryTransferRequest.findUnique.mockResolvedValue({createdBy:'other'});
  await expect(service.create(actor,{sourceWarehouseCode:'1',destinationWarehouseCode:'2',idempotencyKey:'some-key',lines:[]} as any,{} as any)).rejects.toThrow('غير موجود');
  expect(db.inventoryTransferRequest.create).not.toHaveBeenCalled();
 });
 it('retries an already submitted own request without a second submission/audit',async()=>{
  const {service,db}=setup();db.inventoryTransferRequest.findFirst.mockResolvedValue({id:'t1',status:'pending_approval',submittedBy:'u1'});
  expect((await service.submit(actor,'t1',{} as any)).status).toBe('pending_approval');
  expect(db.inventoryTransferRequest.update).not.toHaveBeenCalled();
 });
});
