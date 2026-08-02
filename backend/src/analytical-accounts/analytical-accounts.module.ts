import { Module } from '@nestjs/common';
import { AnalyticalAccountsController } from './analytical-accounts.controller';
import { AnalyticalAccountsService } from './analytical-accounts.service';

@Module({
  controllers: [AnalyticalAccountsController],
  providers: [AnalyticalAccountsService],
  exports: [AnalyticalAccountsService],
})
export class AnalyticalAccountsModule {}
