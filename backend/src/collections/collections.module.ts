import { Module } from '@nestjs/common';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { OracleTestRequestsModule } from '../oracle-test-requests/oracle-test-requests.module';

@Module({
  imports: [OracleTestRequestsModule],
  controllers: [CollectionsController],
  providers: [CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}
