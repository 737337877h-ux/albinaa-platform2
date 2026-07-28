import { Body, Controller, Delete, Get, Param, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { UpsertSettingDto } from './dto/upsert-setting.dto';
import { SettingsService } from './settings.service';

@ApiTags('Settings')
@ApiBearerAuth('access-token')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'قائمة الإعدادات' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.settings.findAll(user.organizationId);
  }

  @Put(':key')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'إنشاء أو تحديث إعداد' })
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body() dto: UpsertSettingDto,
    @Req() req: Request,
  ) {
    return this.settings.upsert(user, key, dto.value, req);
  }

  @Delete(':key')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'حذف إعداد' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Req() req: Request,
  ) {
    return this.settings.remove(user, key, req);
  }
}
