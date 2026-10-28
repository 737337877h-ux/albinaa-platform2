import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { OracleAccountStatementReader } from './oracle-account-statement.reader';
import { OracleTestRequestsModule } from '../oracle-test-requests/oracle-test-requests.module';

@Module({
  imports: [OracleTestRequestsModule],
  controllers: [CustomersController],
  providers: [CustomersService, OracleAccountStatementReader],
  exports: [CustomersService],
})
export class CustomersModule {}
