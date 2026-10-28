import {
  Body, Controller, Get, Param, Post, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { MobileAppReleasesService } from './mobile-app-releases.service';

import { releaseChannel } from './release-channel';

const releaseDir = join(process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'), 'mobile-releases');
if (!existsSync(releaseDir)) mkdirSync(releaseDir, { recursive: true });

const storage = diskStorage({
  destination: (_req, _file, cb) => cb(null, releaseDir),
  filename: (_req, _file, cb) => cb(null, `albinaa-${Date.now()}-${Math.round(Math.random() * 1e9)}.apk`),
});

@ApiTags('Mobile app releases')
@ApiBearerAuth('access-token')
@Controller('mobile-app-releases')
export class MobileAppReleasesController {
  constructor(private readonly releases: MobileAppReleasesService) {}

  @Get()
  @RequirePermissions('settings.manage')
  list(@CurrentUser() actor: AuthUser, @Query('application') application?: string) {
    return this.releases.list(actor, releaseChannel(application).application);
  }

  @Get('latest')
  latest(@CurrentUser() actor: AuthUser, @Query('application') application?: string) {
    return this.releases.latest(actor, releaseChannel(application).application);
  }

  @Post('drafts')
  @RequirePermissions('settings.manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'رفع APK كمسودة فقط دون نشره للمستخدمين' })
  @UseInterceptors(FileInterceptor('file', {
    storage,
    limits: { fileSize: 250 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = extname(file.originalname || '').toLowerCase() === '.apk';
      cb(allowed ? null : new Error('يُسمح بملف APK فقط'), allowed);
    },
  }))
  createDraft(
    @CurrentUser() actor: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { versionName?: string; versionCode?: string; notes?: string; mandatory?: string },
    @Req() req: Request,
    @Query('application') application?: string,
  ) {
    return this.releases.createDraft(actor, file, body, req, releaseChannel(application).application);
  }

  @Post(':id/publish')
  @RequirePermissions('settings.manage')
  publish(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Req() req: Request, @Query('application') application?: string) {
    return this.releases.publish(actor, id, req, releaseChannel(application).application);
  }

  @Get(':id/download')
  async download(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
    @Query('application') application?: string,
  ): Promise<StreamableFile> {
    const file = await this.releases.download(actor, id, releaseChannel(application).application);
    response.setHeader('Content-Type', 'application/vnd.android.package-archive');
    response.setHeader('Content-Length', String(file.size));
    response.setHeader('X-Checksum-SHA256', file.sha256);
    response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    return file.stream;
  }
}
