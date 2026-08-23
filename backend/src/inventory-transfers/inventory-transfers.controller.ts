import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { CreateInventoryTransferDto, ReviewInventoryTransferDto } from './dto/inventory-transfer.dto';
import { InventoryTransfersService } from './inventory-transfers.service';

@ApiTags('Inventory Transfers')
@ApiBearerAuth('access-token')
@Controller('inventory-transfers')
export class InventoryTransfersController {
  constructor(private readonly transfers: InventoryTransfersService) {}

  @Get()
  @RequirePermissions('inventory_transfers.read')
  list(@CurrentUser() user: AuthUser) { return this.transfers.list(user); }

  @Get(':id')
  @RequirePermissions('inventory_transfers.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.transfers.get(user, id); }

  @Post()
  @Idempotent()
  @RequirePermissions('inventory_transfers.create')
  @ApiOperation({ summary: 'Save an INVT001.225 transfer request in the platform only' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInventoryTransferDto, @Req() req: Request) { return this.transfers.create(user, dto, req); }

  @Post(':id/submit')
  @Idempotent()
  @RequirePermissions('inventory_transfers.create')
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.transfers.submit(user, id, req); }

  @Post(':id/dry-run')
  @RequirePermissions('inventory_transfers.dry_run')
  @ApiOperation({ summary: 'Validate against Oracle through SELECT-only gateway; never writes to Oracle' })
  dryRun(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.transfers.dryRun(user, id, req); }

  @Post(':id/approve')
  @Idempotent()
  @RequirePermissions('inventory_transfers.approve')
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewInventoryTransferDto, @Req() req: Request) { return this.transfers.approve(user, id, dto, req); }

  @Post(':id/reject')
  @Idempotent()
  @RequirePermissions('inventory_transfers.approve')
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewInventoryTransferDto, @Req() req: Request) { return this.transfers.reject(user, id, dto, req); }

  @Post(':id/oracle-status/refresh')
  @RequirePermissions('inventory_transfers.read')
  @ApiOperation({ summary: 'Read source-issued, destination-received and linked transfer-completed states' })
  refresh(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.transfers.refreshOracleStatus(user, id, req); }
}
