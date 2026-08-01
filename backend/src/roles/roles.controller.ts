import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { CreateRoleDto } from './dto/create-role.dto';
import { GrantPermissionsDto } from './dto/grant-permissions.dto';
import { RolesService } from './roles.service';
import { UpdateRoleDto } from './dto/update-role.dto';

@ApiTags('Roles & Permissions')
@ApiBearerAuth('access-token')
@RequirePermissions('users.manage')
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('roles')
  @ApiOperation({ summary: 'قائمة الأدوار مع عدد المستخدمين والصلاحيات' })
  findRoles(@CurrentUser() user: AuthUser) {
    return this.roles.findAllRoles(user.organizationId);
  }

  @Post('roles')
  @ApiOperation({ summary: 'إنشاء دور جديد' })
  createRole(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRoleDto,
    @Req() req: Request,
  ) {
    return this.roles.createRole(user, dto, req);
  }

  @Patch('roles/:id')
  @ApiOperation({ summary: 'تعديل اسم الدور' })
  updateRole(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @Req() req: Request,
  ) {
    return this.roles.updateRole(user, id, dto, req);
  }

  @Delete('roles/:id')
  @ApiOperation({ summary: 'حذف دور (ممنوع إذا عليه مستخدمون أو دور نظامي حساس)' })
  deleteRole(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.roles.deleteRole(user, id, req);
  }

  @Get('permissions')
  @ApiOperation({ summary: 'قائمة كل الصلاحيات المتاحة' })
  findPermissions() {
    return this.roles.findAllPermissions();
  }

  @Get('roles/:id/permissions')
  @ApiOperation({ summary: 'صلاحيات دور معين' })
  rolePermissions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.findRolePermissions(user.organizationId, id);
  }

  @Post('roles/:id/permissions')
  @ApiOperation({ summary: 'إضافة صلاحيات لدور — الأدوار النظامية الحساسة تتطلب settings.manage' })
  grant(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantPermissionsDto,
    @Req() req: Request,
  ) {
    return this.roles.grantPermissions(user, id, dto.permissionIds, req);
  }

  @Delete('roles/:id/permissions/:permissionId')
  @ApiOperation({ summary: 'سحب صلاحية من دور' })
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
    @Req() req: Request,
  ) {
    return this.roles.revokePermission(user, id, permissionId, req);
  }
}
