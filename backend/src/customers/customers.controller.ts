import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { AssignCollectorDto } from './dto/assign-collector.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerStatusDto } from './dto/customer-status.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { ReviewDuplicateDto } from './dto/review-duplicate.dto';
import { MergeDuplicateDto } from './dto/merge-duplicate.dto';
import { ReverseCustomerMergeDto } from './dto/reverse-customer-merge.dto';
import { LinkCustomerAccountDto } from './dto/link-customer-account.dto';
import { LinkCustomerAccountsDto } from './dto/link-customer-accounts.dto';
import { StatementQueryDto } from './dto/statement-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { UpdateCreditPolicyDto } from './dto/update-credit-policy.dto';
import { UpdateCreditLimitDto } from './dto/update-credit-limit.dto';
import { CustomersService } from './customers.service';

@ApiTags('Customers')
@ApiBearerAuth('access-token')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('customers.read')
  @ApiOperation({
    summary: 'قائمة العملاء: بحث + تصفية + ترتيب + Pagination. المحصل يرى عملاءه فقط',
  })
  findAll(@CurrentUser() user: AuthUser, @Query() q: QueryCustomersDto) {
    return this.customers.findAll(user, q);
  }

  @Get('duplicates')
  @RequirePermissions('duplicates.review')
  @ApiOperation({ summary: 'حالات تشابه الأسماء بانتظار المراجعة (لا دمج آلي أبدًا)' })
  duplicates(@CurrentUser() user: AuthUser) {
    return this.customers.listDuplicates(user);
  }

  @Get('duplicates/merges')
  @RequirePermissions('duplicates.merge')
  @ApiOperation({ summary: 'عمليات دمج العملاء الحديثة وحالة مهلة التراجع' })
  duplicateMerges(@CurrentUser() user: AuthUser) {
    return this.customers.listMerges(user);
  }

  @Get('data-quality')
  @RequirePermissions('duplicates.review')
  @ApiOperation({ summary: 'Data quality KPIs: missing phone, pending duplicates, multi-currency, suspicious balances (read-only)' })
  dataQuality(@CurrentUser() user: AuthUser) {
    return this.customers.dataQuality(user);
  }

  @Get('advances/summary')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'إجمالي حسابات السلف على الغير حسب العملة ضمن نطاق المستخدم' })
  advancesSummary(@CurrentUser() user: AuthUser) {
    return this.customers.advancesSummary(user);
  }

  @Get('credit-control')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'Paginated credit-control overview, including missing limits and utilization by currency' })
  creditControl(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('missingOnly') missingOnly?: string,
  ) {
    return this.customers.creditControl(user, Number(page ?? 1), Number(limit ?? 25), search, missingOnly === 'true');
  }

  @Patch('duplicates/:pairId')
  @RequirePermissions('duplicates.review')
  @ApiOperation({ summary: 'اعتماد قرار مراجعة حالة تشابه' })
  reviewDuplicate(
    @CurrentUser() user: AuthUser,
    @Param('pairId', ParseUUIDPipe) pairId: string,
    @Body() dto: ReviewDuplicateDto,
    @Req() req: Request,
  ) {
    return this.customers.reviewDuplicate(user, pairId, dto.decision, req);
  }

  @Post('duplicates/:pairId/merge')
  @Idempotent()
  @RequirePermissions('duplicates.merge')
  @ApiOperation({ summary: 'دمج عميلين بعد تأكيد بشري، مع إمكانية التراجع خلال 24 ساعة' })
  mergeDuplicate(
    @CurrentUser() user: AuthUser,
    @Param('pairId', ParseUUIDPipe) pairId: string,
    @Body() dto: MergeDuplicateDto,
    @Req() req: Request,
  ) {
    return this.customers.mergeDuplicate(user, pairId, dto, req);
  }

  @Post('duplicates/merges/:mergeId/reverse')
  @Idempotent()
  @RequirePermissions('duplicates.merge')
  @ApiOperation({ summary: 'التراجع عن دمج عميل خلال المهلة المحددة' })
  reverseMerge(
    @CurrentUser() user: AuthUser,
    @Param('mergeId', ParseUUIDPipe) mergeId: string,
    @Body() dto: ReverseCustomerMergeDto,
    @Req() req: Request,
  ) {
    return this.customers.reverseMerge(user, mergeId, dto, req);
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'Customer 360: البيانات + الأرصدة + الإسناد + السياسة + العدادات' })
  find360(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.find360(user, id);
  }

  @Get(':id/account-group')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'الحساب الرئيسي والفرعي مع الأرصدة المجمعة دون دمج السجلات' })
  accountGroup(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.accountGroup(user, id);
  }

  @Post(':id/account-group/children')
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'ربط حساب عميل مستقل كحساب فرعي دون نقل أو حذف حركاته' })
  linkChildAccount(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkCustomerAccountDto,
    @Req() req: Request,
  ) {
    return this.customers.linkChildAccount(user, id, dto.childCustomerId, req);
  }

  @Post(':id/account-group/children/bulk')
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'ربط عدة حسابات فرعية محددة دفعة واحدة دون نقل الحركات أو دمجها' })
  linkChildAccounts(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkCustomerAccountsDto,
    @Req() req: Request,
  ) {
    return this.customers.linkChildAccounts(user, id, dto.childCustomerIds, req);
  }

  @Delete(':id/account-group/children/:childId')
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'فك ارتباط حساب فرعي مع إبقاء الحساب وحركاته كما هي' })
  unlinkChildAccount(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('childId', ParseUUIDPipe) childId: string,
    @Req() req: Request,
  ) {
    return this.customers.unlinkChildAccount(user, id, childId, req);
  }

  @Patch(':id/credit-policy')
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'تحديث سياسة وحد الائتمان مع تحديث درجة المخاطر فورًا' })
  updateCreditPolicy(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCreditPolicyDto,
    @Req() req: Request,
  ) {
    return this.customers.updateCreditPolicy(user, id, dto, req);
  }

  @Patch(':id/credit-limits/:currency')
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'اعتماد سقف ائتمان مستقل لعملة محددة مع تاريخ السريان' })
  updateCreditLimit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('currency') currency: string,
    @Body() dto: UpdateCreditLimitDto,
    @Req() req: Request,
  ) {
    return this.customers.updateCreditLimit(user, id, currency.toUpperCase(), dto, req);
  }

  @Get(':id/timeline')
  @RequirePermissions('customers.read')
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOperation({ summary: 'الخط الزمني الموحد للعميل (استيرادات، إسنادات، تعديلات...)' })
  timeline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customers.timeline(user, id, Number(page ?? 1), Number(limit ?? 50));
  }

  @Get(':id/balances')
  @RequirePermissions('customers.read', 'balances.read')
  @ApiOperation({ summary: 'أرصدة العميل حسب العملة: المحاسبي + التشغيلي المشتق' })
  balances(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.balances(user, id);
  }

  @Get(':id/statement')
  @RequirePermissions('customers.read', 'balances.read')
  @ApiOperation({ summary: 'كشف حساب بعملة واحدة مع رصيد جارٍ صحيح (يدعم فترة وPagination)' })
  statement(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: StatementQueryDto,
  ) {
    return this.customers.statement(user, id, q);
  }

  @Get(':id/statement.pdf')
  @RequirePermissions('customers.read', 'balances.read')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'كشف حساب PDF عربي بالترويسة وختم عدم الاعتماد' })
  async statementPdf(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: StatementQueryDto,
    @Res() res: Response,
  ) {
    const buffer = await this.customers.statementPdf(user, id, q);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="customer-statement-${id}-${q.currency}.pdf"`);
    res.send(buffer);
  }

  @Post()
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'إنشاء عميل يدويًا (بمنع تكرار الكود + تنبيه تشابه الاسم)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto, @Req() req: Request) {
    return this.customers.create(user, dto, req);
  }

  @Patch(':id')
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'تعديل بيانات عميل (الكود لا يُعدل من هنا)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @Req() req: Request,
  ) {
    return this.customers.update(user, id, dto, req);
  }

  @Patch(':id/status')
  @RequirePermissions('customers.write')
  @ApiOperation({ summary: 'تغيير حالة العميل' })
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CustomerStatusDto,
    @Req() req: Request,
  ) {
    return this.customers.setStatus(user, id, dto.status, req);
  }

  @Post(':id/assign')
  @RequirePermissions('customers.transfer')
  @ApiOperation({ summary: 'نقل العميل إلى محصل آخر — التاريخ السابق يبقى محفوظًا' })
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignCollectorDto,
    @Req() req: Request,
  ) {
    return this.customers.assignCollector(user, id, dto, req);
  }

  @Get(':id/assignment')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'الإسناد الحالي للعميل + قائمة المحصلين النشطين (لاختيار الإسناد)' })
  assignment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.assignment(user, id);
  }

  @Post(':id/unassign')
  @RequirePermissions('customers.transfer')
  @ApiOperation({ summary: 'فك إسناد العميل: إغلاق الإسناد الحالي + إعادة مهامه المفتوحة المسندة للمحصل إلى غير مسندة' })
  unassign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.customers.unassignCollector(user, id, req);
  }
}
