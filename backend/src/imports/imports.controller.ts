import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { ExecuteImportDto } from './dto/execute-import.dto';
import { ImportsService } from './imports.service';

@ApiTags('Imports')
@ApiBearerAuth('access-token')
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post('upload')
  @RequirePermissions('imports.run')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary: 'رفع ملف كشف الحساب — تحقق + تحليل + معاينة (dry-run بدون كتابة بيانات مالية)',
  })
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.imports.upload(user, file, req);
  }

  @Post(':id/execute')
  @HttpCode(200)
  @RequirePermissions('imports.run')
  @ApiOperation({
    summary: 'تنفيذ الاستيراد المعتمد — idempotent: إعادة التنفيذ لا تكرر بيانات',
  })
  execute(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExecuteImportDto,
    @Req() req: Request,
  ) {
    return this.imports.execute(user, id, dto.force ?? false, req);
  }

  @Get()
  @RequirePermissions('imports.read')
  @ApiOperation({ summary: 'سجل عمليات الاستيراد' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.imports.findAll(user);
  }

  @Get(':id')
  @RequirePermissions('imports.read')
  @ApiOperation({ summary: 'تفاصيل عملية استيراد' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.findOne(user, id);
  }

  @Get(':id/report')
  @RequirePermissions('imports.read')
  @ApiOperation({ summary: 'التقرير النهائي: كل عدادات الاستيراد التسعة + الأرصدة قبل/بعد' })
  report(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.getReport(user, id);
  }

  @Get(':id/errors')
  @RequirePermissions('imports.read')
  @ApiOperation({ summary: 'تفاصيل الأخطاء: صفوف تالفة، عملات غير معروفة، أخطاء تنفيذ' })
  errors(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.getErrors(user, id);
  }
}
