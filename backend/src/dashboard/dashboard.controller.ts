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

  @Get('kpis')
  @RequirePermissions('reports.read')
  @ApiOperation({
    summary: 'KPI Dashboard (PR 7): توزيع المخاطر، مهام اليوم، أعلى أسباب المهام، عملاء +120 يوم، أعلى المخاطر، أولوية المهام',
  })
  kpis(@CurrentUser() user: AuthUser) {
    return this.dashboard.kpis(user);
  }

  @Get('summary')
  @RequirePermissions('reports.read')
  @ApiOperation({
    summary: 'المؤشرات الأساسية: العملاء، المدينون/الدائنون لكل عملة، المديونية الجديدة، أعمار تقديرية، آخر استيراد',
  })
  summary(@CurrentUser() user: AuthUser) {
    return this.dashboard.summary(user);
  }

  @Get('nav-counts')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'عدادات الشريط الجانبي: مهام مفتوحة، متابعات ووعود مستحقة ضمن نطاق المستخدم' })
  navCounts(@CurrentUser() user: AuthUser) {
    return this.dashboard.navCounts(user);
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
