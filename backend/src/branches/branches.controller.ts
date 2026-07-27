import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { BranchesService } from './branches.service';
import { BranchStatusDto } from './dto/branch-status.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@ApiTags('Organization & Branches')
@ApiBearerAuth('access-token')
@Controller()
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get('organizations/current')
  @ApiOperation({ summary: 'المنشأة الحالية للمستخدم' })
  currentOrg(@CurrentUser() user: AuthUser) {
    return this.branches.currentOrganization(user.organizationId);
  }

  @Get('branches')
  @ApiOperation({ summary: 'قائمة الفروع' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.branches.findAll(user.organizationId);
  }

  @Get('branches/:id')
  @ApiOperation({ summary: 'تفاصيل فرع' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.branches.findOne(user.organizationId, id);
  }

  @Post('branches')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'إنشاء فرع' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBranchDto, @Req() req: Request) {
    return this.branches.create(user, dto, req);
  }

  @Patch('branches/:id')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'تعديل فرع' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
    @Req() req: Request,
  ) {
    return this.branches.update(user, id, dto, req);
  }

  @Patch('branches/:id/status')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'تفعيل/إيقاف فرع' })
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BranchStatusDto,
    @Req() req: Request,
  ) {
    return this.branches.setStatus(user, id, dto.active, req);
  }
}
