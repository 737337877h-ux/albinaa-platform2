import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { CollectionsService } from './collections.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { QueryCollectionsDto } from './dto/query-collections.dto';
import { ReverseCollectionDto } from './dto/reverse-collection.dto';

@ApiTags('Collections')
@ApiBearerAuth('access-token')
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Post()
  @RequirePermissions('collections.create')
  @ApiOperation({
    summary: 'تسجيل تحصيل — يقيّد تلقائيًا في الدفتر التشغيلي (لا تعديل لاحقًا، لا حذف، التصحيح بعكس فقط)',
  })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCollectionDto, @Req() req: Request) {
    return this.collections.create(user, dto, req);
  }

  @Get()
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'قائمة التحصيلات + إجماليات حسب العملة (المحصل: تحصيلاته فقط)' })
  findAll(@CurrentUser() user: AuthUser, @Query() q: QueryCollectionsDto) {
    return this.collections.findAll(user, q);
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'تفاصيل عملية تحصيل (مع سجل العكس إن وجد)' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.collections.findOne(user, id);
  }

  @Post(':id/reverse')
  @HttpCode(200)
  @RequirePermissions('collections.reverse')
  @ApiOperation({ summary: 'عكس موثق بسبب إلزامي — الأصل يبقى محفوظًا كاملاً' })
  reverse(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseCollectionDto,
    @Req() req: Request,
  ) {
    return this.collections.reverse(user, id, dto, req);
  }

  @Post(':id/handover')
  @HttpCode(200)
  @RequirePermissions('cash.receive')
  @ApiOperation({ summary: 'تأكيد أمين الصندوق استلام النقدية (recorded → handed_to_cashier)' })
  handover(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { receiptNumber?: string },
    @Req() req: Request,
  ) {
    return this.collections.handover(user, id, body?.receiptNumber, req);
  }
}
