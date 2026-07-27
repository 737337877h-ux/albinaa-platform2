import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { GrantRolesDto } from './dto/grant-roles.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserStatusDto } from './dto/user-status.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@Controller('users')
@RequirePermissions('users.manage') // الحماية على مستوى الوحدة كاملة — API لا الواجهة
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'قائمة المستخدمين (بدون أي حقول حساسة)' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.users.findAll(user.organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل مستخدم' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.findOne(user.organizationId, id);
  }

  @Post()
  @ApiOperation({ summary: 'إنشاء مستخدم (مع أدوار ابتدائية اختيارية)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto, @Req() req: Request) {
    return this.users.create(user, dto, req);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'تعديل بيانات مستخدم' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ) {
    return this.users.update(user, id, dto, req);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'تفعيل/تعطيل — لا يوجد حذف نهائي، ويُمنع تعطيل آخر مدير نشط' })
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UserStatusDto,
    @Req() req: Request,
  ) {
    return this.users.setStatus(user, id, dto.isActive, req);
  }

  @Post(':id/reset-password')
  @ApiOperation({ summary: 'إعادة تعيين كلمة مرور (إجراء إداري — يُبطل الجلسات)' })
  resetPassword(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ) {
    return this.users.resetPassword(user, id, dto.newPassword, req);
  }

  @Post(':id/roles')
  @ApiOperation({ summary: 'منح أدوار لمستخدم' })
  grantRoles(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantRolesDto,
    @Req() req: Request,
  ) {
    return this.users.grantRoles(user, id, dto.roleIds, req);
  }

  @Delete(':id/roles/:roleId')
  @ApiOperation({ summary: 'سحب دور من مستخدم (بحماية آخر مدير نشط)' })
  revokeRole(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Req() req: Request,
  ) {
    return this.users.revokeRole(user, id, roleId, req);
  }
}
