import { Module } from '@nestjs/common';
import { AgingController } from './aging.controller';
import { AgingService } from './aging.service';
import { AgingScheduler } from './aging.scheduler';

@Module({ controllers: [AgingController], providers: [AgingService, AgingScheduler], exports: [AgingService] })
export class AgingModule {}
