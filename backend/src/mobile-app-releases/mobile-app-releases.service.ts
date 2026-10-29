import { BadRequestException, ForbiddenException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream, existsSync, unlink } from 'fs';
import { basename } from 'path';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

import { releaseChannel, MobileApplication } from './release-channel';
import { apkIdentity } from './apk-manifest';

export type MobileAppRelease = {
  id: string;
  versionName: string;
  versionCode: number;
  notes: string;
  mandatory: boolean;
  status: 'draft' | 'published' | 'archived';
  originalFileName: string;
  storageKey: string;
  size: number;
  sha256: string;
  createdAt: string;
  createdBy: string;
  publishedAt: string | null;
  publishedBy: string | null;
};

function publicRelease(release: MobileAppRelease, application: MobileApplication = 'collector') {
  const { storageKey: _storageKey, ...safe } = release;
  return { ...safe, application, packageId: releaseChannel(application).packageId, downloadPath: `/mobile-app-releases/${release.id}/download?application=${application}` };
}

async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

@Injectable()
export class MobileAppReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async releases(organizationId: string, application: MobileApplication = 'collector'): Promise<MobileAppRelease[]> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { organizationId_key: { organizationId, key: releaseChannel(application).settingKey } },
    });
    const value = setting?.value as { releases?: MobileAppRelease[] } | null;
    return Array.isArray(value?.releases) ? value!.releases : [];
  }

  private async save(organizationId: string, releases: MobileAppRelease[], application: MobileApplication = 'collector') {
    await this.prisma.systemSetting.upsert({
      where: { organizationId_key: { organizationId, key: releaseChannel(application).settingKey } },
      create: { organizationId, key: releaseChannel(application).settingKey, value: { releases } as any },
      update: { value: { releases } as any },
    });
  }

  async list(actor: AuthUser, application: MobileApplication = 'collector') {
    return (await this.releases(actor.organizationId, application))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(r => publicRelease(r, application));
  }

  async latest(actor: AuthUser, application: MobileApplication = 'collector') {
    const latest = (await this.releases(actor.organizationId, application))
      .filter((release) => release.status === 'published')
      .sort((a, b) => b.versionCode - a.versionCode || String(b.publishedAt).localeCompare(String(a.publishedAt)))[0];
    return latest ? publicRelease(latest, application) : null;
  }

  async createDraft(
    actor: AuthUser,
    file: Express.Multer.File,
    input: { versionName?: string; versionCode?: string | number; notes?: string; mandatory?: string | boolean },
    req?: Request,
    application: MobileApplication = 'collector',
  ) {
    try {
      if (!file) throw new BadRequestException('ملف APK مطلوب');
      const versionName = String(input.versionName ?? '').trim();
      const versionCode = Number(input.versionCode);
      if (!versionName || !Number.isInteger(versionCode) || versionCode <= 0) {
        throw new BadRequestException('اسم الإصدار ورقم الإصدار الصحيحان مطلوبان');
      }
      const channel = releaseChannel(application);
      let identity;
      try { identity = await apkIdentity(file.path); } catch { throw new BadRequestException('تعذر قراءة هوية ملف APK'); }
      if (identity.packageId !== channel.packageId || identity.versionCode !== versionCode || identity.versionName !== versionName) {
        throw new BadRequestException('حزمة APK أو رقم إصدارها لا يطابق قناة التطبيق والبيانات المدخلة');
      }
      const releases = await this.releases(actor.organizationId, application);
      if (releases.some((release) => release.versionCode === versionCode)) {
        throw new BadRequestException('رقم الإصدار مستخدم مسبقًا');
      }
      const now = new Date().toISOString();
      const id = `${versionCode}-${Date.now().toString(36)}`;
      const release: MobileAppRelease = {
        id,
        versionName,
        versionCode,
        notes: String(input.notes ?? '').trim(),
        mandatory: input.mandatory === true || input.mandatory === 'true',
        status: 'draft',
        originalFileName: basename(file.originalname || `albinaa-${versionName}.apk`),
        storageKey: file.path,
        size: file.size,
        sha256: await sha256File(file.path),
        createdAt: now,
        createdBy: actor.id,
        publishedAt: null,
        publishedBy: null,
      };
      await this.save(actor.organizationId, [release, ...releases].slice(0, 30), application);
      await this.audit.log({
        userId: actor.id,
        action: 'mobile_app_release_draft_created',
        entityTable: 'system_settings',
        entityId: id,
        newValue: publicRelease(release, application),
        req,
      });
      return publicRelease(release, application);
    } catch (error) {
      if (file?.path) unlink(file.path, () => undefined);
      throw error;
    }
  }

  async publish(actor: AuthUser, id: string, req?: Request, application: MobileApplication = 'collector') {
    const releases = await this.releases(actor.organizationId, application);
    const target = releases.find((release) => release.id === id);
    if (!target) throw new NotFoundException('الإصدار غير موجود');
    if (!existsSync(target.storageKey)) throw new NotFoundException('ملف APK غير موجود على الخادم');
    const now = new Date().toISOString();
    for (const release of releases) {
      if (release.status === 'published') release.status = 'archived';
    }
    target.status = 'published';
    target.publishedAt = now;
    target.publishedBy = actor.id;
    await this.save(actor.organizationId, releases, application);
    await this.audit.log({
      userId: actor.id,
      action: 'mobile_app_release_published',
      entityTable: 'system_settings',
      entityId: id,
      newValue: publicRelease(target, application),
      req,
    });
    return publicRelease(target, application);
  }

  async download(actor: AuthUser, id: string, application: MobileApplication = 'collector') {
    const release = (await this.releases(actor.organizationId, application)).find((item) => item.id === id);
    if (!release) throw new NotFoundException('الإصدار غير موجود');
    if (release.status !== 'published' && !actor.permissions.includes('settings.manage')) {
      throw new ForbiddenException('هذا الإصدار لم يُنشر بعد');
    }
    if (!existsSync(release.storageKey)) throw new NotFoundException('ملف APK غير موجود على الخادم');
    return {
      stream: new StreamableFile(createReadStream(release.storageKey)),
      fileName: `alraqi-${application}-${release.versionName}.apk`,
      size: release.size,
      sha256: release.sha256,
    };
  }
}
