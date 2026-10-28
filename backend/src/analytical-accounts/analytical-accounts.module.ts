import { Module } from '@nestjs/common';
import { AnalyticalAccountsController } from './analytical-accounts.controller';
import { AnalyticalAccountsService } from './analytical-accounts.service';
import { OracleAdvanceReader } from './oracle-advance.reader';
import { OracleAdvanceSyncService } from './oracle-advance-sync.service';
import { TasksModule } from '../tasks/tasks.module';
import { OracleAdvanceLedgerService } from './oracle-advance-ledger.service';
import { OracleAccountStatementReader } from '../customers/oracle-account-statement.reader';

@Module({
  imports: [TasksModule],
  controllers: [AnalyticalAccountsController],
  providers: [AnalyticalAccountsService, OracleAdvanceReader, OracleAdvanceSyncService, OracleAdvanceLedgerService, OracleAccountStatementReader],
  exports: [AnalyticalAccountsService, OracleAdvanceSyncService],
})
export class AnalyticalAccountsModule {}
