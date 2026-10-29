import { Module } from '@nestjs/common';
import { MobileAppReleasesController } from './mobile-app-releases.controller';
import { MobileAppReleasesService } from './mobile-app-releases.service';

@Module({
  controllers: [MobileAppReleasesController],
  providers: [MobileAppReleasesService],
})
export class MobileAppReleasesModule {}
