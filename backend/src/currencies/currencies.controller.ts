import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { CurrenciesService } from './currencies.service';
import { UpdateCurrencyDto } from './dto/update-currency.dto';

@ApiTags('Currencies')
@ApiBearerAuth('access-token')
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  @Get()
  @ApiOperation({ summary: 'قائمة العملات' })
  findAll() {
    return this.currencies.findAll();
  }

  @Patch(':code')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'تعديل عملة' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body() dto: UpdateCurrencyDto,
    @Req() req: Request,
  ) {
    return this.currencies.update(code, dto, user, req);
  }
}
