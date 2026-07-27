import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { GrantPermissionsDto } from './dto/grant-permissions.dto';
import { RolesService } from './roles.service';

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
