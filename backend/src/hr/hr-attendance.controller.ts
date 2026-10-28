import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import {TimePolicyDto} from './hr-time-policy.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { AttendancePunchDto, AttendanceQueryDto } from './hr-attendance.dto';
import { HrAttendanceService } from './hr-attendance.service';
@Controller('hr/attendance')
export class HrAttendanceController {
 constructor(private readonly hr:HrAttendanceService){}
 @Get('policy') @RequirePermissions('hr.attendance.read') policy(@CurrentUser() u:AuthUser){return this.hr.policy(u);}
 @Put('policy') @RequirePermissions('hr.manage','hr.salary.manage','hr.attendance.read') savePolicy(@CurrentUser() u:AuthUser,@Body() d:TimePolicyDto){return this.hr.savePolicy(u,d);}
 @Get('mine') mine(@CurrentUser() u:AuthUser){return this.hr.mine(u);}
 @Post() punch(@CurrentUser() u:AuthUser,@Body() d:AttendancePunchDto){return this.hr.punch(u,d);}
 @Get('qr') @RequirePermissions('hr.attendance.qr') qr(@CurrentUser() u:AuthUser){return this.hr.qr(u);}
 @Get() @RequirePermissions('hr.attendance.read') report(@CurrentUser() u:AuthUser,@Query() q:AttendanceQueryDto){return this.hr.report(u,q.date);}
}
