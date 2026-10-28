import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AgingModule } from '../aging/aging.module';
import { OracleTestRequestsModule } from '../oracle-test-requests/oracle-test-requests.module';

@Module({
  imports: [AgingModule, OracleTestRequestsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
