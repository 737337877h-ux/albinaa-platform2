import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { CollectorsService } from './collectors.service';
import { CreateCollectorDto } from './dto/create-collector.dto';
import { UpdateCollectorDto } from './dto/update-collector.dto';

@ApiTags('Collectors')
@ApiBearerAuth('access-token')
@Controller('collectors')
export class CollectorsController {
  constructor(private readonly collectors: CollectorsService) {}

  @Get()
  @RequirePermissions('users.manage')
  @ApiOperation({ summary: 'قائمة المحصلين' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.collectors.findAll(user.organizationId);
  }

  @Get(':id')
  @RequirePermissions('users.manage')
  @ApiOperation({ summary: 'تفاصيل محصل' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.collectors.findOne(user.organizationId, id);
  }

  @Post()
  @RequirePermissions('users.manage')
  @ApiOperation({ summary: 'إضافة مستخدم كمحصل' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCollectorDto, @Req() req: Request) {
    return this.collectors.create(user, dto, req);
  }

  @Patch(':id')
  @RequirePermissions('users.manage')
  @ApiOperation({ summary: 'تعديل محصل (الفرع، الحالة)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCollectorDto,
    @Req() req: Request,
  ) {
    return this.collectors.update(user, id, dto, req);
  }
}
