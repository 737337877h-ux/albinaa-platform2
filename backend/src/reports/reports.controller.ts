import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { UpdateCollectorTargetDto } from './dto/update-collector-target.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports') @ApiBearerAuth('access-token') @Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('kpi') @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'DSO وCEI وأداء التحصيل والوعود وترتيب المحصلين خلال 12 شهرًا' })
  kpi(@CurrentUser() user: AuthUser) { return this.reports.kpi(user); }

  @Patch('kpi/targets/:collectorId/:currency') @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'اعتماد هدف تحصيل شهري لمحصل وعملة' })
  target(@CurrentUser() user: AuthUser, @Param('collectorId') collectorId: string, @Param('currency') currency: string, @Body() dto: UpdateCollectorTargetDto, @Req() req: Request) {
    return this.reports.updateTarget(user, collectorId, currency.toUpperCase(), dto, req);
  }
}
