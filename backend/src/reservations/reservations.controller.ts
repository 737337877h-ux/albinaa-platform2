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
import { ReservationsService } from './reservations.service';

// Goods reservations — operational tracking only. No financial balance impact,
// no collections impact, no invoice conversion.
@ApiTags('Reservations')
@ApiBearerAuth('access-token')
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get()
  @RequirePermissions('customers.read')
  @ApiQuery({ name: 'customerId', required: false })
  @ApiOperation({ summary: 'List goods reservations, optionally filtered by customer' })
  findAll(@CurrentUser() user: AuthUser, @Query('customerId') customerId?: string) {
    return this.reservations.findAll(user, customerId);
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'Reservation detail' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reservations.findOne(user, id);
  }

  @Post()
  @RequirePermissions('reservations.manage')
  @ApiOperation({ summary: 'Create a goods reservation for a customer (no balance impact)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReservationDto, @Req() req: Request) {
    return this.reservations.create(user, dto, req);
  }

  @Patch(':id')
  @RequirePermissions('reservations.manage')
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
  @RequirePermissions('reservations.manage')
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
  @RequirePermissions('reservations.manage')
  @ApiOperation({ summary: 'Cancel a reservation (not allowed once completed)' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.reservations.cancel(user, id, req);
  }
}
