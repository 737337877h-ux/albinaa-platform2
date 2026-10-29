import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { AccountingPeriodsService } from './accounting-periods.service';
import { LockAccountingPeriodDto, UnlockAccountingPeriodDto } from './dto/period.dto';

@ApiTags('Accounting periods')
@ApiBearerAuth('access-token')
@Controller('accounting-periods')
export class AccountingPeriodsController {
  constructor(private readonly periods: AccountingPeriodsService) {}

  @Get() @RequirePermissions('periods.manage')
  list(@CurrentUser() actor: AuthUser, @Query('year') year?: string) { return this.periods.list(actor, year ? Number(year) : undefined); }

  @Post('lock') @RequirePermissions('periods.manage')
  lock(@CurrentUser() actor: AuthUser, @Body() dto: LockAccountingPeriodDto, @Req() req: Request) { return this.periods.lock(actor, dto.year, dto.month, dto.reason, req); }

  @Post(':id/unlock') @RequirePermissions('periods.manage')
  unlock(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UnlockAccountingPeriodDto, @Req() req: Request) { return this.periods.unlock(actor, id, dto.reason, req); }
}

