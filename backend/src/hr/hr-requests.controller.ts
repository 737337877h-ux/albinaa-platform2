import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { HrRequestsService } from './hr-requests.service';
import { HrDecisionDto, HrLoginDto, HrRequestDto } from './hr-requests.dto';
@Controller('hr/requests')
export class HrRequestsController {
 constructor(private readonly hr:HrRequestsService){}
 @Get('mine') mine(@CurrentUser() u:AuthUser){return this.hr.mine(u);}
 @Post() create(@CurrentUser() u:AuthUser,@Body() d:HrRequestDto){return this.hr.create(u,d);}
 @Put(':id/decision') decision(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() d:HrDecisionDto){return this.hr.decide(u,id,d);}
 @Get() @RequirePermissions('hr.requests.review') list(@CurrentUser() u:AuthUser){return this.hr.admin(u);}
 @Get('links') @RequirePermissions('hr.read','hr.manage') links(@CurrentUser() u:AuthUser){return this.hr.links(u);}
 @Put('links/:id') @RequirePermissions('hr.read','hr.manage') link(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() d:HrLoginDto){return this.hr.link(u,id,d);}
}
