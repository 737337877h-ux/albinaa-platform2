import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth('access-token')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions('reports.read')
  @ApiOperation({
    summary: 'المؤشرات الأساسية: العملاء، المدينون/الدائنون لكل عملة، المديونية الجديدة، أعمار تقديرية، آخر استيراد',
  })
  summary(@CurrentUser() user: AuthUser) {
    return this.dashboard.summary(user);
  }

  @Get('collector')
  @RequirePermissions('tasks.manage')
  @ApiQuery({ name: 'collectorId', required: false, description: 'للإشراف — افتراضي: المحصل الحالي' })
  @ApiOperation({
    summary: 'لوحة المحصل: عملاؤه، تواصل اليوم، متابعات ووعود متأخرة، تحصيلات اليوم/الأسبوع، الأرصدة بالعملة',
  })
  collector(@CurrentUser() user: AuthUser, @Query('collectorId') collectorId?: string) {
    return this.dashboard.collectorDashboard(user, collectorId);
  }
}
