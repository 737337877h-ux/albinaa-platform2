import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ReviewOracleExceptionDto } from './dto/review-oracle-exception.dto';
import { OracleExceptionReviewService } from './oracle-exception-review.service';
import { OracleMonitoringService } from './oracle-monitoring.service';

@ApiTags('Oracle Mirror Monitoring')
@ApiBearerAuth('access-token')
@RequirePermissions('settings.manage')
@Controller('oracle-monitoring')
export class OracleMonitoringController {
  constructor(private readonly monitoring: OracleMonitoringService, private readonly exceptions: OracleExceptionReviewService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Oracle mirror health and recent read-only sync runs' })
  summary(@CurrentUser() actor: AuthUser) {
    return this.monitoring.summary(actor.organizationId);
  }

  @Get('exceptions')
  @ApiOperation({ summary: 'List quarantined Oracle mirror movements and their platform-only reviews' })
  listExceptions(@CurrentUser() actor: AuthUser, @Query('review') review?: string,
    @Query('kind') kind?: string, @Query('reason') reason?: string) {
    return this.exceptions.list(actor.organizationId, { review, kind, reason });
  }

  @Post('exceptions/:id/review')
  @Idempotent()
  @ApiOperation({ summary: 'Review one Oracle mirror exception; Oracle always remains read-only' })
  reviewException(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewOracleExceptionDto) {
    return this.exceptions.review(actor.organizationId, id, actor.id, dto.decision, dto.notes.trim());
  }
}
