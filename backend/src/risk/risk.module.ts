import { Global, Module } from '@nestjs/common';
import { RiskController } from './risk.controller';
import { RiskScheduler } from './risk.scheduler';
import { RiskService } from './risk.service';
import { RiskRefreshService } from './risk-refresh.service';
import { AgingModule } from '../aging/aging.module';

@Global()
@Module({
  imports: [AgingModule],
  controllers: [RiskController],
  providers: [RiskService, RiskRefreshService, RiskScheduler],
  exports: [RiskService, RiskRefreshService],
})
export class RiskModule {}
