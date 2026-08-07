import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { AssignmentsService } from './assignments.service';
import { BulkAssignmentDto } from './dto/bulk-assignment.dto';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { SmartAssignmentDto } from './dto/smart-assignment.dto';

@ApiTags('Assignments')
@ApiBearerAuth('access-token')
@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get()
  @RequirePermissions('customers.read')
  @ApiQuery({ name: 'collectorId', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'currentOnly', required: false })
  @ApiOperation({ summary: 'سجل الإسنادات — التاريخ الكامل محفوظ دائمًا' })
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('collectorId') collectorId?: string,
    @Query('customerId') customerId?: string,
    @Query('currentOnly') currentOnly?: string,
  ) {
    return this.assignments.findAll(user, { collectorId, customerId, currentOnly: currentOnly === 'true' });
  }

  @Post()
  @RequirePermissions('customers.transfer')
  @ApiOperation({ summary: 'إسناد/نقل عميل — يغلق الإسناد الحالي ويفتح جديدًا (لا حذف للتاريخ)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAssignmentDto, @Req() req: Request) {
    return this.assignments.create(user, dto, req);
  }

  @Patch(':id/end')
  @HttpCode(200)
  @RequirePermissions('customers.transfer')
  @ApiOperation({ summary: 'إنهاء إسناد حالي دون فتح بديل (يصبح العميل بلا محصل)' })
  end(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.assignments.end(user, id, req);
  }

  @Get('collectors')
  @RequirePermissions('customers.transfer')
  @ApiOperation({ summary: 'Active collectors available as bulk assignment targets' })
  listCollectors(@CurrentUser() user: AuthUser) {
    return this.assignments.listActiveCollectors(user);
  }

  @Post('bulk/preview')
  @HttpCode(200)
  @RequirePermissions('customers.transfer')
  @ApiOperation({ summary: 'Bulk assign/transfer preview: returns counts without writing anything' })
  bulkPreview(@CurrentUser() user: AuthUser, @Body() dto: BulkAssignmentDto) {
    return this.assignments.previewBulkAssign(user, dto);
  }

  @Post('bulk')
  @RequirePermissions('customers.transfer')
  @ApiOperation({ summary: 'Bulk assign/transfer selected customers to one target collector' })
  bulkExecute(@CurrentUser() user: AuthUser, @Body() dto: BulkAssignmentDto, @Req() req: Request) {
    return this.assignments.executeBulkAssign(user, dto, req);
  }

  @Post('smart/preview')
  @HttpCode(200)
  @RequirePermissions('customers.transfer')
  @ApiOperation({ summary: 'Preview balanced assignment across active collectors using workload and region affinity' })
  smartPreview(@CurrentUser() user: AuthUser, @Body() dto: SmartAssignmentDto) {
    return this.assignments.previewSmartAssign(user, dto);
  }

  @Post('smart')
  @RequirePermissions('customers.transfer')
  @ApiOperation({ summary: 'Execute the reviewed smart balanced assignment plan' })
  smartExecute(@CurrentUser() user: AuthUser, @Body() dto: SmartAssignmentDto, @Req() req: Request) {
    return this.assignments.executeSmartAssign(user, dto, req);
  }
}
