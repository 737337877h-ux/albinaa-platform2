import {
  BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import { extname, join } from 'path';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { GpsPointDto } from './dto/gps-point.dto';
import { SyncRequestDto } from './dto/sync-request.dto';
import { UploadReceiptDto } from './dto/upload-receipt.dto';
import { MobileService } from './mobile.service';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];

const uploadDir = join(process.cwd(), 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

function fileFilter(_req: any, file: Express.Multer.File, cb: (error: Error | null, accept: boolean) => void) {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new BadRequestException(`نوع الملف غير مسموح: ${file.mimetype}`), false);
  }
  const ext = extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new BadRequestException(`امتداد الملف غير مسموح: ${ext}`), false);
  }
  cb(null, true);
}

const storage = diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  },
});

@ApiTags('Mobile')
@ApiBearerAuth('access-token')
@Controller('mobile')
export class MobileController {
  constructor(private readonly mobile: MobileService) {}

  @Post('upload-receipt')
  @ApiOperation({ summary: 'رفع صورة سند تحصيل' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'صورة السند مع معرّف التحصيل',
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        collectionId: { type: 'string' },
        notes: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadReceipt(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadReceiptDto,
  ) {
    return this.mobile.uploadReceipt(user, file, dto);
  }

  @Post('gps')
  @ApiOperation({ summary: 'رفع نقطة GPS' })
  saveGps(@CurrentUser() user: AuthUser, @Body() dto: GpsPointDto) {
    return this.mobile.saveGps(user, dto);
  }

  @Post('gps/batch')
  @ApiOperation({ summary: 'رفع مجموعة نقاط GPS' })
  saveGpsBatch(@CurrentUser() user: AuthUser, @Body() dtos: GpsPointDto[]) {
    return this.mobile.saveGpsBatch(user, dtos);
  }

  @Post('sync')
  @ApiOperation({ summary: 'مزامنة كاملة للجوال' })
  sync(@CurrentUser() user: AuthUser, @Body() dto: SyncRequestDto) {
    return this.mobile.sync(user, dto.lastSyncToken);
  }

  @Get('customers')
  @ApiOperation({ summary: 'قائمة العملاء المبسطة للجوال' })
  findCustomers(@CurrentUser() user: AuthUser) {
    return this.mobile.findCustomers(user);
  }

  @Get('customers/:id')
  @ApiOperation({ summary: 'عرض عميل 360 مبسط للجوال' })
  findCustomer360(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.mobile.findCustomer360(user, id);
  }
}
