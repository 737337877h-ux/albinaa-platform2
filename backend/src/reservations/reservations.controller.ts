import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { IssueReservationDto } from './dto/issue-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { CreateUnitDto, UpdateUnitDto } from './dto/manage-unit.dto';
import { ReservationsService } from './reservations.service';

// Goods reservations — operational tracking only. No financial balance impact,
// no collections impact, no invoice conversion.
@ApiTags('Reservations')
@ApiBearerAuth('access-token')
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get('units')
  @RequirePermissions('reservations.read')
  @ApiOperation({ summary: 'Active normalized units used by goods reservations' })
  units() {
    return this.reservations.listUnits();
  }

  @Get('units/all')
  @RequirePermissions('reservations.manage')
  @ApiOperation({ summary: 'List all reservation units for administration' })
  allUnits() {
    return this.reservations.listAllUnits();
  }

  @Post('units')
  @RequirePermissions('reservations.manage')
  @ApiOperation({ summary: 'Create a normalized reservation unit' })
  createUnit(@CurrentUser() user: AuthUser, @Body() dto: CreateUnitDto, @Req() req: Request) {
    return this.reservations.createUnit(user, dto, req);
  }

  @Patch('units/:id')
  @RequirePermissions('reservations.manage')
  @ApiOperation({ summary: 'Update or deactivate a reservation unit' })
  updateUnit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitDto,
    @Req() req: Request,
  ) {
    return this.reservations.updateUnit(user, id, dto, req);
  }

  @Get('summary')
  @RequirePermissions('reservations.read')
  @ApiOperation({ summary: 'Aggregated active-reservations dashboard summary, separated by currency' })
  summary(@CurrentUser() user: AuthUser) {
    return this.reservations.summary(user);
  }

  @Get()
  @RequirePermissions('reservations.read')
  @ApiQuery({ name: 'customerId', required: false })
  @ApiOperation({ summary: 'List goods reservations, optionally filtered by customer' })
  findAll(@CurrentUser() user: AuthUser, @Query('customerId') customerId?: string) {
    return this.reservations.findAll(user, customerId);
  }

  @Get(':id')
  @RequirePermissions('reservations.read')
  @ApiOperation({ summary: 'Reservation detail' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reservations.findOne(user, id);
  }

  @Post()
  @RequirePermissions('reservations.create')
  @ApiOperation({ summary: 'Create a goods reservation for a customer (no balance impact)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReservationDto, @Req() req: Request) {
    return this.reservations.create(user, dto, req);
  }

  @Patch(':id')
  @RequirePermissions('reservations.extend')
  @ApiOperation({ summary: 'Update reservation operational fields (warehouse/document/notes/expiry)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReservationDto,
    @Req() req: Request,
  ) {
    return this.reservations.update(user, id, dto, req);
  }

  @Post(':id/issue')
  @RequirePermissions('reservations.deliver')
  @ApiOperation({ summary: 'Issue reserved goods (reduces remaining quantity only)' })
  issue(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IssueReservationDto,
    @Req() req: Request,
  ) {
    return this.reservations.issue(user, id, dto, req);
  }

  @Post(':id/cancel')
  @RequirePermissions('reservations.cancel')
  @ApiOperation({ summary: 'Cancel a reservation (not allowed once completed)' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.reservations.cancel(user, id, req);
  }
}
