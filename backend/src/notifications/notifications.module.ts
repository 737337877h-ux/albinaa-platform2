import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import {EmployeeMessagesService} from './employee-messages.service';
import {EmployeeMessagesController} from './employee-messages.controller';

@Global()
@Module({
  controllers: [NotificationsController,EmployeeMessagesController],
  providers: [NotificationsService,EmployeeMessagesService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
