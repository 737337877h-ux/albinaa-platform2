import { Module } from '@nestjs/common';
import { SalesOrderDraftsController } from './sales-order-drafts.controller';
import { SalesOrderDraftsService } from './sales-order-drafts.service';
import { OracleCustomerOrdersReader } from './oracle-customer-orders.reader';
import { QuotationsController } from './quotations.controller';
import { CustomerOrdersController } from './customer-orders.controller';

@Module({
  controllers: [SalesOrderDraftsController, QuotationsController, CustomerOrdersController],
  providers: [SalesOrderDraftsService, OracleCustomerOrdersReader],
  exports: [SalesOrderDraftsService],
})
export class SalesOrderDraftsModule {}
