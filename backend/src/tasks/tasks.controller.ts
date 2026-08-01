import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { CreateTaskDto } from './dto/create-task.dto';
import { TasksService } from './tasks.service';

@ApiTags('Daily Tasks')
@ApiBearerAuth('access-token')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('today')
  @RequirePermissions('tasks.manage')
  @ApiQuery({ name: 'collectorId', required: false, description: 'للإشراف فقط — افتراضي: المحصل الحالي' })
  @ApiOperation({
    summary: 'عمل اليوم: وعود مستحقة/متأخرة، غير المتابعين منذ X يوم، الرصيد المرتفع، المخاطر العالية — بأولوية. ' +
      'لحساب إداري بلا سجل محصل شخصي وبلا collectorId: يعيد 200 بنتيجة فارغة (isCollector=false) لا خطأ',
  })
  today(@CurrentUser() user: AuthUser, @Query('collectorId') collectorId?: string) {
    return this.tasks.today(user, collectorId);
  }

  @Post('generate-today')
  @RequirePermissions('tasks.manage')
  @ApiOperation({
    summary: 'توليد قائمة عمل اليوم: مهام مخزنة من درجات المخاطر، تقادم الديون، الوعود، المتابعات، الأرصدة، ' +
      'والإسنادات — مع منع التكرار (عميل+عملة+نوع+تاريخ+مصدر) ودمج الأسباب وعدم نقل العملاء',
  })
  generateToday(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.tasks.generateToday(user, req);
  }

  @Get()
  @RequirePermissions('tasks.manage')
  @ApiQuery({ name: 'collectorId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiOperation({ summary: 'المهام المخزنة (المفتوحة افتراضيًا)' })
  list(
    @CurrentUser() user: AuthUser,
    @Query('collectorId') collectorId?: string,
    @Query('status') status?: string,
  ) {
    return this.tasks.list(user, collectorId, status ?? 'open');
  }

  @Post()
  @RequirePermissions('tasks.manage')
  @ApiOperation({ summary: 'إنشاء مهمة جديدة' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskDto) {
    return this.tasks.create(user, dto);
  }

  @Patch(':id/complete')
  @RequirePermissions('tasks.manage')
  @ApiOperation({ summary: 'إتمام مهمة' })
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.complete(user, id);
  }
}
