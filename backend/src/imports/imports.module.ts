import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ParserService } from './parser.service';

@Module({
  controllers: [ImportsController],
  providers: [ImportsService, ParserService],
})
export class ImportsModule {}
