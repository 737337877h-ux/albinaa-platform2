import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { AssignCollectorDto } from './dto/assign-collector.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerStatusDto } from './dto/customer-status.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { ReviewDuplicateDto } from './dto/review-duplicate.dto';
import { StatementQueryDto } from './dto/statement-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
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

  @Get(':id')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'Customer 360: البيانات + الأرصدة + الإسناد + السياسة + العدادات' })
  find360(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.find360(user, id);
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
}
