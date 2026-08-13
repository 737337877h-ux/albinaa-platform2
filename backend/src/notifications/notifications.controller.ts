import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { PushTokenDto, RemovePushTokenDto } from './dto/push-token.dto';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('push-tokens')
  @ApiOperation({ summary: 'تسجيل جهاز المستخدم لاستقبال إشعارات الهاتف' })
  registerPushToken(@CurrentUser() user: AuthUser, @Body() body: PushTokenDto) {
    return this.notifications.registerPushToken(user, body);
  }

  @Delete('push-tokens')
  @ApiOperation({ summary: 'إلغاء تسجيل جهاز المستخدم من إشعارات الهاتف' })
  unregisterPushToken(@CurrentUser() user: AuthUser, @Body() body: RemovePushTokenDto) {
    return this.notifications.unregisterPushToken(user, body.token);
  }

  @Get()
  @ApiQuery({ name: 'unreadOnly', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOperation({ summary: 'إشعاراتي (مع عدّاد غير المقروء)' })
  list(
    @CurrentUser() user: AuthUser,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.listMine(
      user, unreadOnly === 'true', Number(page ?? 1), Number(limit ?? 25),
    );
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'تحديد كل إشعاراتي كمقروءة' })
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'تحديد إشعار كمقروء' })
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user, id);
  }
}
