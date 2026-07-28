import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { CreateFollowupDto } from './dto/create-followup.dto';
import { QueryFollowupsDto } from './dto/query-followups.dto';
import { UpdateFollowupDto } from './dto/update-followup.dto';
import { FollowupsService } from './followups.service';

@ApiTags('Followups')
@ApiBearerAuth('access-token')
@Controller('followups')
export class FollowupsController {
  constructor(private readonly followups: FollowupsService) {}

  @Post()
  @RequirePermissions('followups.create')
  @ApiOperation({ summary: 'تسجيل متابعة — النتيجة إلزامية (قاعدة معتمدة)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFollowupDto, @Req() req: Request) {
    return this.followups.create(user, dto, req);
  }

  @Get()
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'قائمة المتابعات (المحصل: متابعات عملائه فقط)' })
  findAll(@CurrentUser() user: AuthUser, @Query() q: QueryFollowupsDto) {
    return this.followups.findAll(user, q);
  }

  @Get('types')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'أنواع المتابعات النشطة للمنظمة الحالية' })
  listTypes(@CurrentUser() user: AuthUser) {
    return this.followups.listTypes(user);
  }

  @Get('results')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'نتائج المتابعات النشطة للمنظمة الحالية' })
  listResults(@CurrentUser() user: AuthUser) {
    return this.followups.listResults(user);
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'تفاصيل متابعة' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.followups.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('followups.create')
  @ApiOperation({ summary: 'تعديل متابعة (منفذها أو إداري)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFollowupDto,
    @Req() req: Request,
  ) {
    return this.followups.update(user, id, dto, req);
  }

  @Delete(':id')
  @RequirePermissions('followups.create')
  @ApiOperation({ summary: 'حذف ناعم فقط — السجل يبقى للتدقيق' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.followups.softDelete(user, id, req);
  }
}
