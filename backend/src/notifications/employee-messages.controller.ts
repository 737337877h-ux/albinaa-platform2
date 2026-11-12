import {Body,Controller,Get,Param,ParseUUIDPipe,Post} from '@nestjs/common';
import {CurrentUser} from '../common/decorators/current-user.decorator';
import {RequirePermissions} from '../common/decorators/permissions.decorator';
import {Idempotent} from '../common/decorators/idempotent.decorator';
import {AuthUser} from '../common/guards/jwt-auth.guard';
import {EmployeeMessagesService} from './employee-messages.service';
import {CustomerReminderDto,StaffBroadcastDto} from './employee-messages.dto';
@Controller('employee-messages')
export class EmployeeMessagesController {
 constructor(private readonly messages:EmployeeMessagesService){}
 @Post('customers/:id/remind') @RequirePermissions('customers.remind') @Idempotent('user')
 remind(@CurrentUser() actor:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() body:CustomerReminderDto){return this.messages.remindCustomer(actor,id,body.operationId);}
 @Get('recipients') @RequirePermissions('notifications.broadcast')
 async recipients(@CurrentUser() actor:AuthUser){return {count:await this.messages.recipients(actor)};}
 @Post('broadcast') @RequirePermissions('notifications.broadcast') @Idempotent('user')
 broadcast(@CurrentUser() actor:AuthUser,@Body() body:StaffBroadcastDto){return this.messages.broadcast(actor,body);}
}
