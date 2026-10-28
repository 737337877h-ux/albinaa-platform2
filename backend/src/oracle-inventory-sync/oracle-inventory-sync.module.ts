import { Module } from '@nestjs/common';
import { BarcodePrintController, BarcodePrintService } from './barcode-print.controller';
import { OracleInventorySnapshotService } from './oracle-inventory-snapshot.service';
import { OracleInventorySyncService } from './oracle-inventory-sync.service';
import { OracleInventoryPublicationService } from './oracle-inventory-publication.service';
import { OracleInventoryReadController } from './oracle-inventory-read.controller';
import { OracleInventoryReadService } from './oracle-inventory-read.service';

@Module({
  controllers: [OracleInventoryReadController, BarcodePrintController],
  providers: [
    BarcodePrintService,
    OracleInventorySnapshotService,
    OracleInventorySyncService,
    OracleInventoryPublicationService,
    OracleInventoryReadService,
  ],
  exports: [
    OracleInventorySnapshotService,
    OracleInventorySyncService,
    OracleInventoryPublicationService,
    OracleInventoryReadService,
  ],
})
export class OracleInventorySyncModule {}
