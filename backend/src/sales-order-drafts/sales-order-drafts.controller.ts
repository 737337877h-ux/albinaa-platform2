import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { SalesOrderDraftsService } from './sales-order-drafts.service';
import { CreateSalesOrderDraftDto } from './dto/create-sales-order-draft.dto';
import { ProcessSalesOrderDraftDto } from './dto/process-sales-order-draft.dto';
import { UpdateSalesOrderDraftDto } from './dto/update-sales-order-draft.dto';
import { ListSalesOrderDraftsQueryDto } from './dto/list-sales-order-drafts-query.dto';

@ApiTags('Sales Order Drafts')
@ApiBearerAuth('access-token')
@Controller('sales-order-drafts')
export class SalesOrderDraftsController {
  constructor(private readonly drafts: SalesOrderDraftsService) {}

  @Get()
  @RequirePermissions('sales_order_drafts.read')
  @ApiOperation({ summary: 'Platform-only customer sales-order drafts; no Oracle write path' })
  list(@CurrentUser() actor: AuthUser, @Query() query: ListSalesOrderDraftsQueryDto) {
    return this.drafts.list(actor, query);
  }

  @Get('offline')
  @RequirePermissions('sales_order_drafts.read')
  @ApiOperation({ summary: 'Complete compact customer-order mirror for mobile offline storage' })
  offline(@CurrentUser() actor: AuthUser) { return this.drafts.offline(actor); }

  @Post('sync-oracle')
  @RequirePermissions('sales_order_drafts.manage')
  @ApiOperation({ summary: 'Read IAS20261 customer orders through the SELECT-only gateway into the platform mirror' })
  syncOracle(@CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.drafts.syncOracle(actor, req);
  }

  @Get('catalog/customers')
  @RequirePermissions('sales_order_drafts.read')
  customerCatalog(@CurrentUser() actor: AuthUser, @Query('search') search = '') {
    return this.drafts.customerCatalog(actor, search);
  }

  @Get('catalog/items')
  @RequirePermissions('sales_order_drafts.read')
  itemCatalog(@CurrentUser() actor: AuthUser, @Query('search') search = '') {
    return this.drafts.itemCatalog(actor, search);
  }

  @Get('catalog/warehouses')
  @RequirePermissions('sales_order_drafts.read')
  warehouseCatalog(@CurrentUser() actor: AuthUser) {
    return this.drafts.warehouseCatalog(actor);
  }

  @Post()
  @RequirePermissions('sales_order_drafts.manage')
  @ApiOperation({ summary: 'Create a platform-only draft; never publishes or writes to Oracle' })
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateSalesOrderDraftDto, @Req() req: Request) {
    return this.drafts.create(actor, dto, req);
  }

  @Patch(':id')
  @RequirePermissions('sales_order_drafts.manage')
  @ApiOperation({ summary: 'Update platform review fields only; never updates Oracle' })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalesOrderDraftDto,
    @Req() req: Request,
  ) { return this.drafts.update(actor, id, dto, req); }

  @Post(':id/process')
  @RequirePermissions('sales_order_drafts.manage')
  @ApiOperation({ summary: 'Move the platform review status only; never approves or processes Oracle' })
  process(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProcessSalesOrderDraftDto,
    @Req() req: Request,
  ) { return this.drafts.process(actor, id, dto, req); }

  @Post('dry-run')
  @RequirePermissions('sales_order_drafts.manage')
  @ApiOperation({ summary: 'Validate a customer request against IAS20261 mirrors without any Oracle or platform write' })
  dryRun(@CurrentUser() actor: AuthUser, @Body() dto: CreateSalesOrderDraftDto) {
    return this.drafts.dryRun(actor, dto);
  }

  @Get(':id')
  @RequirePermissions('sales_order_drafts.read')
  get(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.drafts.get(actor, id);
  }
}
