import { Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { AgingService } from './aging.service';
import { AgingQueryDto } from './dto/aging-query.dto';

@ApiTags('Reports - Aging')
@ApiBearerAuth('access-token')
@Controller('reports/aging')
export class AgingController {
  constructor(private readonly aging: AgingService) {}

  @Get()
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'تقرير أعمار الديون بتوزيع FIFO، مفصول حسب العملة' })
  report(@CurrentUser() user: AuthUser, @Query() query: AgingQueryDto) {
    return this.aging.report(user, query);
  }

  @Post('snapshots')
  @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'إقفال لقطة أعمار الديون الحالية للمراجعة الشهرية' })
  snapshot(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.aging.createSnapshot(user, req);
  }
}
