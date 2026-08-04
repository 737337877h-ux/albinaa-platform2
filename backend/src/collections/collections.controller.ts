import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { CollectionsService } from './collections.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { QueryCollectionsDto } from './dto/query-collections.dto';
import { ReverseCollectionDto } from './dto/reverse-collection.dto';
import { CreateHandoverVoucherDto } from './dto/create-handover-voucher.dto';
import { ReviewReversalRequestDto } from './dto/review-reversal-request.dto';

@ApiTags('Collections')
@ApiBearerAuth('access-token')
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Idempotent()
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

  @Get('methods')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'طرق التحصيل النشطة للمنظمة الحالية' })
  listMethods(@CurrentUser() user: AuthUser) {
    return this.collections.listMethods(user);
  }

  @Get('reconciliation')
  @RequirePermissions('collections.approve')
  @ApiOperation({ summary: 'لوحة مطابقة الصندوق: التحصيلات المتاحة، قسائم التسليم، وطلبات العكس المعلقة' })
  reconciliation(
    @CurrentUser() user: AuthUser,
    @Query('collectorId') collectorId?: string,
    @Query('branchId') branchId?: string,
    @Query('currency') currency?: string,
  ) {
    return this.collections.reconciliationBoard(user, { collectorId, branchId, currency });
  }

  @Post('reconciliation/vouchers')
  @RequirePermissions('collections.approve')
  @ApiOperation({ summary: 'إنشاء قسيمة تسليم جماعية متسلسلة لتحصيلات محصل/فرع/عملة واحدة' })
  createVoucher(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateHandoverVoucherDto,
    @Req() req: Request,
  ) {
    return this.collections.createHandoverVoucher(user, dto, req);
  }

  @Post('reconciliation/vouchers/:id/match')
  @HttpCode(200)
  @RequirePermissions('cash.receive')
  @ApiOperation({ summary: 'مطابقة أمين الصندوق لقسيمة التسليم وتحويل تحصيلاتها إلى matched' })
  matchVoucher(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.collections.matchHandoverVoucher(user, id, req);
  }

  @Post('reconciliation/vouchers/:id/lock')
  @HttpCode(200)
  @RequirePermissions('collections.approve')
  @ApiOperation({ summary: 'اعتماد القسيمة وقفلها وتحويل تحصيلاتها إلى approved' })
  lockVoucher(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.collections.lockHandoverVoucher(user, id, req);
  }

  @Post('reconciliation/reversal-requests/:id/review')
  @HttpCode(200)
  @RequirePermissions('collections.approve')
  @ApiOperation({ summary: 'موافقة/رفض طلب عكس بواسطة مستخدم ثانٍ (Maker-Checker)' })
  reviewReversal(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewReversalRequestDto,
    @Req() req: Request,
  ) {
    return this.collections.reviewReversal(user, id, dto, req);
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
  @ApiOperation({ summary: 'إنشاء طلب عكس بسبب إلزامي — لا ينفذ حتى يعتمد مستخدم ثانٍ' })
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
