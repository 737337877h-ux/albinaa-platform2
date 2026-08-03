import { Module } from '@nestjs/common';
import { RiskController } from './risk.controller';
import { RiskScheduler } from './risk.scheduler';
import { RiskService } from './risk.service';

@Module({
  controllers: [RiskController],
  providers: [RiskService, RiskScheduler],
})
export class RiskModule {}
