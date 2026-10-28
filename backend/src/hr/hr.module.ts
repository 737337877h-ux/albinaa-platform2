import {HrTaskAttachmentsService} from './hr-task-attachments.service';
import {HrProfileController} from './hr-profile.controller';
import {HrProfileService} from './hr-profile.service';
import {HrAbsenceService} from './hr-absence.service';
import {HrAbsenceDto} from './hr-profile.dto';
import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { EmployeeDto, SalaryDto } from './hr.dto';
import { HrService } from './hr.service';
import { HrStatementReader } from './hr-statement.reader';
import { HrPayrollService } from './hr-payroll.service';
import { ApprovePayrollDto, ReopenPayrollDto, HrPeriodDto, SavePayrollDto } from './hr-payroll.dto';
import { payrollCsv } from './hr-payroll-export';
import { HrRequestsService } from './hr-requests.service';
import { HrRequestsController } from './hr-requests.controller';
import { HrAttendanceController } from './hr-attendance.controller';
import { HrAttendanceService } from './hr-attendance.service';
import { HrTasksService } from './hr-tasks.service';
import { HrTasksController } from './hr-tasks.controller';
import {HrPushService} from './hr-push.service';
import {HrAttendanceDisplayController} from './hr-attendance-display.controller';

@Controller('hr/employees')
export class HrController {
 constructor(private readonly hr:HrService,private readonly payroll:HrPayrollService,private readonly absence:HrAbsenceService){}
 @Put(':id/absence') @RequirePermissions('hr.read','hr.manage','hr.attendance.read') absenceReview(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() d:HrAbsenceDto){return this.absence.review(u,id,d);}
 @Get(':id/statement') @RequirePermissions('hr.read','hr.salary.read','hr.payroll.read') statement(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query() q:HrPeriodDto){return this.payroll.statement(u,id,q);}
 @Get(':id/payroll') @RequirePermissions('hr.read','hr.salary.read','hr.payroll.read') payrollWorkspace(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query() q:HrPeriodDto){return this.payroll.workspace(u,id,q);}
 @Put(':id/payroll') @RequirePermissions('hr.read','hr.salary.read','hr.payroll.read','hr.payroll.manage') savePayroll(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query() q:HrPeriodDto,@Body() d:SavePayrollDto){return this.payroll.save(u,id,q,d);}
 @Get() @RequirePermissions('hr.read') list(@CurrentUser() u:AuthUser){return this.hr.list(u);}
 @Post() @RequirePermissions('hr.read','hr.manage') create(@CurrentUser() u:AuthUser,@Body() d:EmployeeDto){return this.hr.save(u,d);}
 @Put(':id') @RequirePermissions('hr.read','hr.manage') save(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() d:EmployeeDto){return this.hr.save(u,d,id);}
 @Post(':id/salaries') @RequirePermissions('hr.read','hr.salary.read','hr.salary.manage') salary(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() d:SalaryDto){return this.hr.salary(u,id,d);}
}
@Controller('hr/payroll')
export class HrPayrollController {
 constructor(private readonly payroll:HrPayrollService,private readonly absence:HrAbsenceService){}
 @Get('mine') mine(@CurrentUser() u:AuthUser,@Query() q:HrPeriodDto){return this.payroll.mine(u,q);}
 @Get() @RequirePermissions('hr.read','hr.salary.read','hr.payroll.read') monthly(@CurrentUser() u:AuthUser,@Query() q:HrPeriodDto){return this.payroll.monthly(u,q);}
 @Post('approve') @RequirePermissions('hr.read','hr.salary.read','hr.payroll.read','hr.payroll.approve') approve(@CurrentUser() u:AuthUser,@Query() q:HrPeriodDto,@Body() d:ApprovePayrollDto){return this.payroll.approve(u,q,d);}
 @Post('reopen') @RequirePermissions('hr.read','hr.salary.read','hr.payroll.read','hr.payroll.approve') reopen(@CurrentUser() u:AuthUser,@Query() q:HrPeriodDto,@Body() d:ReopenPayrollDto){return this.payroll.reopen(u,q,d);}
 @Get('export') @RequirePermissions('hr.read','hr.salary.read','hr.payroll.read') async export(@CurrentUser() u:AuthUser,@Query() q:HrPeriodDto){return payrollCsv(await this.payroll.monthly(u,q));}
 @Get('revisions/:id') @RequirePermissions('hr.read','hr.salary.read','hr.payroll.read') revision(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.payroll.revision(u,id);}
}
@Module({controllers:[HrProfileController,HrController,HrPayrollController,HrRequestsController,HrAttendanceController,HrTasksController,HrAttendanceDisplayController],providers:[HrTaskAttachmentsService,HrAbsenceService,HrProfileService,HrService,HrStatementReader,HrPayrollService,HrRequestsService,HrAttendanceService,HrTasksService,HrPushService]})
export class HrModule{}
