import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { CreatePromiseDto } from './dto/create-promise.dto';
import { PromiseStatusDto } from './dto/promise-status.dto';
import { QueryPromisesDto } from './dto/query-promises.dto';
import { UpdatePromiseDto } from './dto/update-promise.dto';
import { PromisesService } from './promises.service';

@ApiTags('Payment Promises')
@ApiBearerAuth('access-token')
@Controller('payment-promises')
export class PromisesController {
  constructor(private readonly promises: PromisesService) {}

  @Post()
  @RequirePermissions('promises.create')
  @ApiOperation({ summary: 'تسجيل وعد سداد — ينشئ مهمة تلقائية بتاريخ الاستحقاق + تذكيرًا للمحصل' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePromiseDto, @Req() req: Request) {
    return this.promises.create(user, dto, req);
  }

  @Get()
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'قائمة الوعود (المحصل: وعوده فقط)' })
  findAll(@CurrentUser() user: AuthUser, @Query() q: QueryPromisesDto) {
    return this.promises.findAll(user, q);
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'تفاصيل وعد مع مهامه' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.promises.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('promises.create')
  @ApiOperation({ summary: 'تعديل وعد مفتوح (الحالات النهائية لا تُعدل)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromiseDto,
    @Req() req: Request,
  ) {
    return this.promises.update(user, id, dto, req);
  }

  @Patch(':id/status')
  @RequirePermissions('promises.create')
  @ApiOperation({ summary: 'تغيير حالة الوعد — الإخلال يفتح تصعيدًا تلقائيًا' })
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PromiseStatusDto,
    @Req() req: Request,
  ) {
    return this.promises.setStatus(user, id, dto, req);
  }
}
