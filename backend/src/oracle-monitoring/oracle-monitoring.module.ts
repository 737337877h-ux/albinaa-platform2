import { Module } from '@nestjs/common';
import { OracleMonitoringController } from './oracle-monitoring.controller';
import { OracleMonitoringService } from './oracle-monitoring.service';
import { OracleExceptionReviewService } from './oracle-exception-review.service';
import { OracleInventorySyncModule } from '../oracle-inventory-sync/oracle-inventory-sync.module';
import { OracleMovementAutoPublicationService } from '../oracle-movement-sync/oracle-movement-auto-publication.service';

@Module({
  imports: [OracleInventorySyncModule],
  controllers: [OracleMonitoringController],
  providers: [OracleMonitoringService, OracleExceptionReviewService, OracleMovementAutoPublicationService],
})
export class OracleMonitoringModule {}
