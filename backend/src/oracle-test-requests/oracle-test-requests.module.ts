import { Module } from '@nestjs/common';
import { InventoryTransfersModule } from '../inventory-transfers/inventory-transfers.module';
import { OracleTestRequestsController } from './oracle-test-requests.controller';
import { OracleTestRequestsService } from './oracle-test-requests.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [InventoryTransfersModule, PrismaModule],
  controllers: [OracleTestRequestsController],
  providers: [OracleTestRequestsService],
  exports: [OracleTestRequestsService],
})
export class OracleTestRequestsModule {}
