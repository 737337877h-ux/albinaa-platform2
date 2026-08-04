import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AgingModule } from '../aging/aging.module';

@Module({ imports: [AgingModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
