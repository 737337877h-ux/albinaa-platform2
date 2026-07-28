import { Module } from '@nestjs/common';
import { CollectorsController } from './collectors.controller';
import { CollectorsService } from './collectors.service';

@Module({
  controllers: [CollectorsController],
  providers: [CollectorsService],
})
export class CollectorsModule {}
