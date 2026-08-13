import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileController } from './mobile.controller';
import { MobileService } from './mobile.service';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
  imports: [PrismaModule, DashboardModule],
  controllers: [MobileController],
  providers: [MobileService],
})
export class MobileModule {}
