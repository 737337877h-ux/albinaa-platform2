import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AgingModule } from '../aging/aging.module';

@Module({
  imports: [AgingModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
