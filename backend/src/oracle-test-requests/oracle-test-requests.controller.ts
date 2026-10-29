import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireAnyPermissions, RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { InventoryTransfersService } from '../inventory-transfers/inventory-transfers.service';
import { OracleInventoryItemsQueryDto } from '../oracle-inventory-sync/dto/oracle-inventory-query.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { OracleTestRequestsService } from './oracle-test-requests.service';

@ApiTags('Oracle Test Requests')
@ApiBearerAuth('access-token')
@Controller('oracle-test-requests')
export class OracleTestRequestsController {
  constructor(
    private readonly requests: OracleTestRequestsService,
    private readonly audit: AuditService,
    private readonly inventoryTransfers: InventoryTransfersService,
    private readonly notifications: NotificationsService,
  ) {}

  private async auditedCreate(
    kind: string,
    user: AuthUser,
    req: Request,
    operation: () => Promise<unknown>,
    context: Record<string, unknown> = {},
  ) {
    const result = await operation() as {
      requestNo?: string; requestSerial?: string; documentNo?: string; documentSerial?: string;
      created?: boolean; schema?: string;
      collectorNo?: number;
    };
    if (context.requestKind === 'receipt' && result.collectorNo != null) {
      context = { ...context, collectorNo: result.collectorNo };
    }
    const schema = result.schema === 'IAS20261' ? 'IAS20261' : 'IAS20191';
    await this.audit.log({
      userId: user.id,
      action: 'oracle_test_request_created',
      entityTable: schema,
      entityId: result.requestSerial ?? result.documentSerial ?? null,
      newValue: {
        ...context,
        kind, requestNo: result.requestNo, requestSerial: result.requestSerial,
        documentNo: result.documentNo, documentSerial: result.documentSerial, created: result.created,
      },
      reason: `إنشاء مسودة طلب يمن سوفت في بيئة ${schema} التجريبية`,
      req,
    });
    if (context.requestKind === 'receipt') {
      await this.notifications.notifyByPermissions(
        user.organizationId,
        ['cash.receive', 'collections.approve', 'finance.alerts.receive', 'settings.manage'],
        'collection_created',
        {
          requestNo: result.requestNo,
          requestSerial: result.requestSerial,
          customerId: context.platformCustomerId,
          customerName: context.recipientName,
          amount: context.amount,
          currency: context.currencyCode,
          collectorNo: context.collectorNo,
          href: '/collections',
        },
      );
    }
    return result;
  }

  private assertVoucherPermission(user: AuthUser, body: unknown) {
    const kind = (body as { kind?: unknown } | null)?.kind;
    const permission = kind === 'payment'
      ? 'oracle_test_requests.payment.create'
      : kind === 'receipt'
        ? 'oracle_test_requests.receipt.create'
        : null;
    if (!permission || !user.permissions.includes(permission)) {
      throw new ForbiddenException('لا تملك صلاحية إنشاء هذا النوع من السندات');
    }
  }

  @Get('created')
  @RequireAnyPermissions(
    'oracle_test_requests.purchase.read', 'oracle_test_requests.receipt.read',
    'oracle_test_requests.payment.read', 'oracle_test_requests.journal.read',
    'oracle_test_requests.inventory_count.read', 'inventory_transfers.read',
  )
  created(@CurrentUser() user: AuthUser) { return this.requests.created(user.permissions, user); }

  @Get('currencies')
  @RequireAnyPermissions(
    'oracle_test_requests.purchase.create', 'oracle_test_requests.receipt.create',
    'oracle_test_requests.payment.create', 'oracle_test_requests.journal.create',
  )
  currencies() { return this.requests.currencies(); }
  @Get('catalog')
  @RequireAnyPermissions(
    'oracle_test_requests.receipt.create', 'oracle_test_requests.payment.create',
    'oracle_test_requests.journal.create',
  )
  catalog(@CurrentUser() user: AuthUser, @Query('purpose') purpose = 'receipt') {
    return this.requests.catalog(purpose, user);
  }
  @Post('inventory-counts/dry-run')
  @RequireAnyPermissions('oracle_test_requests.inventory_count.create', 'mobile.inventory_count.create')
  inventoryCountCreateDryRun(@Body() body: unknown) {
    return this.requests.inventoryCountCreateDryRun(body);
  }
  @Post('inventory-counts')
  @RequireAnyPermissions('oracle_test_requests.inventory_count.create', 'mobile.inventory_count.create')
  inventoryCountCreate(@Body() body: unknown, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.auditedCreate('inventory_count', user, req, () => this.requests.inventoryCountCreate(body));
  }
  @Get('inventory-counts/lookups/items')
  @RequireAnyPermissions('oracle_test_requests.inventory_count.create', 'mobile.inventory_count.create')
  inventoryCountItemOptions(
    @CurrentUser() user: AuthUser,
    @Query() query: OracleInventoryItemsQueryDto,
  ) {
    return this.inventoryTransfers.itemOptions(user, query);
  }
  @Get('inventory-counts/:documentNo')
  @RequirePermissions('oracle_test_requests.inventory_count.read')
  inventoryCount(
    @Param('documentNo', ParseIntPipe) documentNo: number,
    @Query('inventoryType') inventoryType = '1',
    @Query('branchNo') branchNo = '1',
    @Query('branchYear') branchYear = '2026',
  ) {
    return this.requests.inventoryCount({ documentNo, inventoryType, branchNo, branchYear });
  }
  @Post('inventory-counts/:documentNo/dry-run')
  @RequirePermissions('oracle_test_requests.inventory_count.read', 'oracle_test_requests.inventory_count.dry_run')
  inventoryCountDryRun(
    @Param('documentNo', ParseIntPipe) documentNo: number,
    @Query('inventoryType') inventoryType = '1',
    @Query('branchNo') branchNo = '1',
    @Query('branchYear') branchYear = '2026',
  ) {
    return this.requests.inventoryCountDryRun({ documentNo, inventoryType, branchNo, branchYear });
  }
  @Get('purchases/lookups/warehouses')
  @RequirePermissions('oracle_test_requests.purchase.create')
  purchaseWarehouseOptions(@CurrentUser() user: AuthUser) {
    return this.inventoryTransfers.warehouseOptions(user);
  }
  @Get('purchases/lookups/items')
  @RequirePermissions('oracle_test_requests.purchase.create')
  purchaseItemOptions(@CurrentUser() user: AuthUser, @Query() query: OracleInventoryItemsQueryDto) {
    return this.inventoryTransfers.itemOptions(user, query);
  }
  @Get('purchases/lookups/items/:externalItemCode')
  @RequirePermissions('oracle_test_requests.purchase.create')
  purchaseItemOption(@CurrentUser() user: AuthUser, @Param('externalItemCode') externalItemCode: string) {
    return this.inventoryTransfers.itemOption(user, externalItemCode);
  }
  @RequirePermissions('oracle_test_requests.purchase.create')
  @Post('purchases/dry-run') purchaseDryRun(@Body() body: unknown) { return this.requests.purchaseDryRun(body); }
  @RequirePermissions('oracle_test_requests.purchase.create')
  @Post('purchases') purchaseCreate(@Body() body: unknown, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.auditedCreate('purchase', user, req, () => this.requests.purchaseCreate(body));
  }
  @Post('vouchers/dry-run')
  @RequireAnyPermissions('oracle_test_requests.receipt.create', 'oracle_test_requests.payment.create')
  voucherDryRun(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    this.assertVoucherPermission(user, body);
    return this.requests.voucherDryRun(body, user);
  }
  @Post('vouchers')
  @RequireAnyPermissions('oracle_test_requests.receipt.create', 'oracle_test_requests.payment.create')
  voucherCreate(@Body() body: unknown, @CurrentUser() user: AuthUser, @Req() req: Request) {
    this.assertVoucherPermission(user, body);
    const input = body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown> : {};
    const lines = Array.isArray(input.lines) ? input.lines as Array<Record<string, unknown>> : [];
    const line = lines[0] ?? {};
    return this.auditedCreate('voucher', user, req, () => this.requests.voucherCreate(body, user), {
      requestKind: input.kind,
      platformCustomerId: input.platformCustomerId,
      platformCustomerCode: input.platformCustomerCode,
      currencyCode: line.currencyCode,
      amount: line.amount,
      recipientName: input.recipientName,
      collectorNo: input.collectorNo,
      externalReference: input.externalReference,
      paymentMethod: input.paymentMethod,
      cashOrBankNo: input.cashOrBankNo,
      description: input.description,
      referenceNo: input.referenceNo,
    });
  }
  @RequirePermissions('oracle_test_requests.journal.create')
  @Post('journals/dry-run') journalDryRun(@Body() body: unknown) { return this.requests.journalDryRun(body); }
  @RequirePermissions('oracle_test_requests.journal.create')
  @Post('journals') journalCreate(@Body() body: unknown, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.auditedCreate('journal', user, req, () => this.requests.journalCreate(body));
  }
}
