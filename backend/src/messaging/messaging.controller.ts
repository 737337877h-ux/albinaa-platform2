import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { CampaignDto } from './dto/campaign.dto';
import { MessagingService } from './messaging.service';

@ApiTags('Messaging campaigns')
@ApiBearerAuth('access-token')
@Controller('messaging/campaigns')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  @RequirePermissions('tasks.manage')
  list(@CurrentUser() user: AuthUser) { return this.messaging.list(user); }

  @Get(':id')
  @RequirePermissions('tasks.manage')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.detail(user, id);
  }

  @Post('preview')
  @RequirePermissions('tasks.manage')
  @ApiOperation({ summary: 'Preview aging-based recipients without sending or writing data' })
  preview(@CurrentUser() user: AuthUser, @Body() dto: CampaignDto) {
    return this.messaging.preview(user, dto);
  }

  @Post()
  @RequirePermissions('tasks.manage')
  @ApiOperation({ summary: 'Prepare a tracked campaign; external sending remains disabled until an official provider is configured' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CampaignDto, @Req() req: Request) {
    return this.messaging.create(user, dto, req);
  }

  @Post(':campaignId/dispatches/:dispatchId/opened')
  @RequirePermissions('tasks.manage')
  markOpened(
    @CurrentUser() user: AuthUser,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('dispatchId', ParseUUIDPipe) dispatchId: string,
    @Req() req: Request,
  ) {
    return this.messaging.markOpened(user, campaignId, dispatchId, req);
  }
}
