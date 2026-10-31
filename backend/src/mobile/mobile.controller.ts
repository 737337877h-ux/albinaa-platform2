import {
  BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import { extname, join } from 'path';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { GpsPointDto } from './dto/gps-point.dto';
import { SyncRequestDto } from './dto/sync-request.dto';
import { UploadReceiptDto } from './dto/upload-receipt.dto';
import { UploadOracleRequestReceiptDto } from './dto/upload-oracle-request-receipt.dto';
import { UpdateCustomerFieldDto } from './dto/update-customer-field.dto';
import { DeviceHeartbeatDto } from './dto/device-heartbeat.dto';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { MobileService } from './mobile.service';
import { OracleInventoryItemsQueryDto, OracleInventorySourceQueryDto } from '../oracle-inventory-sync/dto/oracle-inventory-query.dto';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];

const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

function normalizeMime(mime: string | undefined): string {
  const m = (mime || '').toLowerCase().trim();
  if (m === 'image/jpg' || m === 'image/pjpeg') return 'image/jpeg';
  return m;
}

function fileFilter(_req: any, file: Express.Multer.File, cb: (error: Error | null, accept: boolean) => void) {
  const mime = normalizeMime(file.mimetype);
  file.mimetype = mime;
  if (!ALLOWED_MIME_TYPES.includes(mime) && !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new BadRequestException(`نوع الملف غير مسموح: ${file.mimetype}`), false);
  }
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'].includes(mime)) {
    return cb(new BadRequestException(`نوع الملف غير مسموح: ${file.mimetype}`), false);
  }
  const ext = extname(file.originalname || '').toLowerCase();
  if (ext && !ALLOWED_EXTENSIONS.includes(ext)) {
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

  @Idempotent()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('upload-receipt')
  @ApiOperation({ summary: 'رفع صورة سند تحصيل — حد 20 طلب/دقيقة' })
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

  @Idempotent()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('upload-request-receipt')
  @ApiOperation({ summary: 'رفع صورة إيصال مرتبطة بطلب سند قبض أو صرف' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadOracleRequestReceipt(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadOracleRequestReceiptDto,
  ) {
    return this.mobile.uploadOracleRequestReceipt(user, file, dto);
  }

  @Get('receipts/:id')
  @ApiOperation({ summary: 'تحميل صورة سند تحصيل' })
  downloadReceipt(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    return this.mobile.downloadReceipt(user, id);
  }

  @Idempotent()
  @Post('gps')
  @ApiOperation({ summary: 'رفع نقطة GPS' })
  saveGps(@CurrentUser() user: AuthUser, @Body() dto: GpsPointDto) {
    return this.mobile.saveGps(user, dto);
  }

  @Idempotent()
  @Post('gps/batch')
  @ApiOperation({ summary: 'رفع مجموعة نقاط GPS' })
  saveGpsBatch(@CurrentUser() user: AuthUser, @Body() dtos: GpsPointDto[]) {
    return this.mobile.saveGpsBatch(user, dtos);
  }

  @Post('sync')
  @ApiOperation({ summary: 'مزامنة كاملة للجوال' })
  sync(@CurrentUser() user: AuthUser, @Body() dto: SyncRequestDto) {
    return this.mobile.sync(user, dto.lastSyncToken, false, false, dto.inventoryCatalogVersion);
  }

  @Post('operations-sync')
  @ApiOperation({ summary: 'مزامنة تطبيق العمليات دون أرصدة أو نشاط التحصيل' })
  operationsSync(@CurrentUser() user: AuthUser, @Body() dto: SyncRequestDto) {
    return this.mobile.sync(user, dto.lastSyncToken, true, false, dto.inventoryCatalogVersion);
  }

  @Post('collection-sync')
  @ApiOperation({ summary: 'مزامنة التحصيل دون المخزون والحجوزات' })
  collectionSync(@CurrentUser() user: AuthUser, @Body() dto: SyncRequestDto) {
    return this.mobile.sync(user, dto.lastSyncToken, false, true, dto.inventoryCatalogVersion);
  }

  @Post('heartbeat')
  @ApiOperation({ summary: 'تحديث حالة اتصال ومزامنة جهاز التطبيق' })
  heartbeat(@CurrentUser() user: AuthUser, @Body() dto: DeviceHeartbeatDto) {
    return this.mobile.deviceHeartbeat(user, dto);
  }

  @Get('devices')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'لوحة مراقبة أجهزة التطبيق ضمن المؤسسة' })
  devices(@CurrentUser() user: AuthUser) {
    return this.mobile.deviceSessions(user);
  }

  @Get('customers')
  @ApiOperation({ summary: 'قائمة العملاء المبسطة للجوال' })
  findCustomers(@CurrentUser() user: AuthUser) {
    return this.mobile.findCustomers(user);
  }

  @Idempotent()
  @Patch('customers/:id/field-update')
  @ApiOperation({ summary: 'تحديث هاتف أو موقع عميل مسند من تطبيق الجوال' })
  updateCustomerField(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerFieldDto,
  ) {
    return this.mobile.updateCustomerField(user, id, dto);
  }

  @Get('customers/:id')
  @ApiOperation({ summary: 'عرض عميل 360 مبسط للجوال' })
  findCustomer360(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.mobile.findCustomer360(user, id);
  }

  @Get('inventory/summary')
  @ApiOperation({ summary: 'ملخص المخزون المنشور لتطبيق الجوال — قراءة فقط' })
  inventorySummary(@CurrentUser() user: AuthUser, @Query() query: OracleInventorySourceQueryDto) {
    return this.mobile.mobileInventorySummary(user, query);
  }

  @Get('inventory/items')
  @ApiOperation({ summary: 'بحث أصناف المخزون المنشور لتطبيق الجوال — قراءة فقط' })
  inventoryItems(@CurrentUser() user: AuthUser, @Query() query: OracleInventoryItemsQueryDto) {
    return this.mobile.mobileInventoryItems(user, query);
  }

  @Get('inventory/items/:code')
  @ApiOperation({ summary: 'تفاصيل ورصيد صنف منشور لتطبيق الجوال — قراءة فقط' })
  inventoryItem(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Query() query: OracleInventorySourceQueryDto,
  ) {
    return this.mobile.mobileInventoryItem(user, code, query);
  }
}
