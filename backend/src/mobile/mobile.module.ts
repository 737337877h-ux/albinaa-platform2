import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileController } from './mobile.controller';
import { MobileService } from './mobile.service';

@Module({
  imports: [PrismaModule],
  controllers: [MobileController],
  providers: [MobileService],
})
export class MobileModule {}
