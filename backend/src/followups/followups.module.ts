import { Module } from '@nestjs/common';
import { ContactAttemptController, ContactAttemptService } from './contact-attempt.controller';
import { FollowupsController } from './followups.controller';
import { FollowupsService } from './followups.service';

@Module({
  controllers: [FollowupsController, ContactAttemptController],
  providers: [FollowupsService, ContactAttemptService],
  exports: [FollowupsService],
})
export class FollowupsModule {}
