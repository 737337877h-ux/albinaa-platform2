import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileController } from './mobile.controller';
import { MobileService } from './mobile.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { OracleInventorySyncModule } from '../oracle-inventory-sync/oracle-inventory-sync.module';
import { OracleTestRequestsModule } from '../oracle-test-requests/oracle-test-requests.module';

@Module({
  imports: [PrismaModule, DashboardModule, OracleInventorySyncModule, OracleTestRequestsModule],
  controllers: [MobileController],
  providers: [MobileService],
})
export class MobileModule {}
