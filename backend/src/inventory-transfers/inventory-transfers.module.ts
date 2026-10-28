import { Module } from '@nestjs/common';
import { OracleInventorySyncModule } from '../oracle-inventory-sync/oracle-inventory-sync.module';
import { InventoryTransfersController } from './inventory-transfers.controller';
import { InventoryTransfersService } from './inventory-transfers.service';
import { OracleInventoryReader, ReadOnlyOracleHttpReader } from './oracle-inventory.reader';
import { OracleOutRequestHttpWriter, OracleOutRequestWriter } from './oracle-out-request.writer';

@Module({
  imports: [OracleInventorySyncModule],
  controllers: [InventoryTransfersController],
  providers: [
    InventoryTransfersService,
    ReadOnlyOracleHttpReader,
    { provide: OracleInventoryReader, useExisting: ReadOnlyOracleHttpReader },
    OracleOutRequestHttpWriter,
    { provide: OracleOutRequestWriter, useExisting: OracleOutRequestHttpWriter },
  ],
  exports: [InventoryTransfersService],
})
export class InventoryTransfersModule {}
