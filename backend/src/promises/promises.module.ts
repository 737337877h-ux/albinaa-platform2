import { Module } from '@nestjs/common';
import { PromisesController } from './promises.controller';
import { PromiseReminderScheduler } from './promise-reminder.scheduler';
import { PromisesService } from './promises.service';
import { PromiseSettlementService } from './promise-settlement.service';

@Module({
  controllers: [PromisesController],
  providers: [PromisesService, PromiseReminderScheduler, PromiseSettlementService],
  exports: [PromisesService, PromiseSettlementService],
})
export class PromisesModule {}
