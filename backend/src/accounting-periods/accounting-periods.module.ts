import { Global, Module } from '@nestjs/common';
import { AccountingPeriodsController } from './accounting-periods.controller';
import { AccountingPeriodsService } from './accounting-periods.service';

@Global()
@Module({ controllers: [AccountingPeriodsController], providers: [AccountingPeriodsService], exports: [AccountingPeriodsService] })
export class AccountingPeriodsModule {}

