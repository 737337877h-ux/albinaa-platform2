import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import {
  OracleInventoryItemsQueryDto,
  OracleInventorySourceQueryDto,
  OracleInventoryStockQueryDto,
  OracleInventoryWarehousesQueryDto,
} from './dto/oracle-inventory-query.dto';
import { OracleInventoryReadService } from './oracle-inventory-read.service';

@ApiTags('Oracle Inventory - Read Only')
@ApiBearerAuth('access-token')
@RequirePermissions('inventory.read')
@Controller('oracle-inventory')
export class OracleInventoryReadController {
  constructor(private readonly inventory: OracleInventoryReadService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Published Oracle inventory snapshot summary (read only)' })
  summary(@CurrentUser() actor: AuthUser, @Query() query: OracleInventorySourceQueryDto) {
    return this.inventory.summary(actor, query);
  }

  @Get('item-groups')
  @ApiOperation({ summary: 'Published Oracle item groups (read only)' })
  itemGroups(@CurrentUser() actor: AuthUser, @Query() query: OracleInventorySourceQueryDto) {
    return this.inventory.itemGroups(actor, query);
  }

  @Get('items')
  @ApiOperation({ summary: 'Published Oracle items with search and pagination (read only)' })
  items(@CurrentUser() actor: AuthUser, @Query() query: OracleInventoryItemsQueryDto) {
    return this.inventory.items(actor, query);
  }

  @Get('items/:externalItemCode')
  @ApiOperation({ summary: 'Published Oracle item details, units, and stock (read only)' })
  item(
    @CurrentUser() actor: AuthUser,
    @Param('externalItemCode') externalItemCode: string,
    @Query() query: OracleInventorySourceQueryDto,
  ) {
    return this.inventory.item(actor, externalItemCode, query);
  }

  @Get('warehouses')
  @ApiOperation({ summary: 'Published Oracle warehouses and verified branch mappings (read only)' })
  warehouses(@CurrentUser() actor: AuthUser, @Query() query: OracleInventoryWarehousesQueryDto) {
    return this.inventory.warehouses(actor, query);
  }

  @Get('stock-balances')
  @ApiOperation({ summary: 'Published Oracle stock balances with search and pagination (read only)' })
  stockBalances(@CurrentUser() actor: AuthUser, @Query() query: OracleInventoryStockQueryDto) {
    return this.inventory.stockBalances(actor, query);
  }

  @Post('barcode-prints')
  @ApiOperation({ summary: 'Record a barcode print or ZPL preparation event' })
  recordBarcodePrint(
    @CurrentUser() actor: AuthUser,
    @Body() body: { itemCode?: string; copies?: number; channel?: string; sourceSchema?: string },
    @Req() req: Request,
  ) {
    return this.inventory.recordBarcodePrint(actor, body, req);
  }

  @Get('barcode-prints/report')
  @ApiOperation({ summary: 'Barcode printing coverage and history' })
  barcodePrintReport(@CurrentUser() actor: AuthUser, @Query('sourceSchema') sourceSchema?: string) {
    return this.inventory.barcodePrintReport(actor, sourceSchema);
  }
}
