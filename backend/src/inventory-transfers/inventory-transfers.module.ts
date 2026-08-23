import { Module } from '@nestjs/common';
import { InventoryTransfersController } from './inventory-transfers.controller';
import { InventoryTransfersService } from './inventory-transfers.service';
import { OracleInventoryReader, ReadOnlyOracleHttpReader } from './oracle-inventory.reader';

@Module({
  controllers: [InventoryTransfersController],
  providers: [
    InventoryTransfersService,
    ReadOnlyOracleHttpReader,
    { provide: OracleInventoryReader, useExisting: ReadOnlyOracleHttpReader },
  ],
  exports: [InventoryTransfersService],
})
export class InventoryTransfersModule {}
