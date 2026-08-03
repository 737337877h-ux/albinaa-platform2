import { Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { RiskRefreshService } from './risk-refresh.service';
import { RiskService } from './risk.service';

@ApiTags('Risk')
@ApiBearerAuth('access-token')
@Controller()
export class RiskController {
  constructor(
    private readonly risk: RiskService,
    private readonly refresh: RiskRefreshService,
  ) {}

  @Post('risk/recalculate')
  @RequirePermissions('risk.recalculate')
  @ApiOperation({
    summary:
      'إعادة احتساب درجات المخاطر لكل عملاء المنظمة وفق الصيغة المعتمدة (idempotent — لا تكرار عند إعادة التنفيذ)',
  })
  recalculate(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.refresh.refreshAll(user, 'manual', req);
  }

  @Get('customers/:id/risk')
  @RequirePermissions('risk.read')
  @ApiOperation({ summary: 'درجة مخاطر عميل (أحدث نتيجة محسوبة)' })
  find(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.risk.findForCustomer(user, id);
  }
}
