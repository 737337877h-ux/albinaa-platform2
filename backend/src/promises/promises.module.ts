import { Module } from '@nestjs/common';
import { PromisesController } from './promises.controller';
import { PromiseReminderScheduler } from './promise-reminder.scheduler';
import { PromisesService } from './promises.service';

@Module({
  controllers: [PromisesController],
  providers: [PromisesService, PromiseReminderScheduler],
  exports: [PromisesService],
})
export class PromisesModule {}
