import { Body, Controller, Get, Param, Patch, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { UpdateCollectorTargetDto } from './dto/update-collector-target.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports') @ApiBearerAuth('access-token') @Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary') @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'ملخص شامل مفصول بالعملة: المديونية، أعلى المدينين، الحجوزات، المحصلون، والتعتيق' })
  summary(@CurrentUser() user: AuthUser, @Query('accountClass') accountClass?: string) {
    return this.reports.summary(user, accountClass === 'advance' ? 'advance' : 'customer');
  }

  @Get('summary.xlsx') @RequirePermissions('reports.export') @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'تصدير التقرير الشامل إلى Excel منسق مع تجميد الرأس وعرض أعمدة تلقائي' })
  async summaryExcel(@CurrentUser() user: AuthUser, @Query('accountClass') accountClass: string | undefined, @Res() res: Response) {
    const buffer = await this.reports.summaryWorkbook(user, accountClass === 'advance' ? 'advance' : 'customer');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="albinaa-report-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buffer);
  }

  @Get('kpi') @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'DSO وCEI وأداء التحصيل والوعود وترتيب المحصلين خلال 12 شهرًا' })
  kpi(@CurrentUser() user: AuthUser, @Query('accountClass') accountClass?: string) {
    return this.reports.kpi(user, accountClass === 'advance' ? 'advance' : 'customer');
  }

  @Patch('kpi/targets/:collectorId/:currency') @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'اعتماد هدف تحصيل شهري لمحصل وعملة' })
  target(@CurrentUser() user: AuthUser, @Param('collectorId') collectorId: string, @Param('currency') currency: string, @Body() dto: UpdateCollectorTargetDto, @Req() req: Request) {
    return this.reports.updateTarget(user, collectorId, currency.toUpperCase(), dto, req);
  }
}
