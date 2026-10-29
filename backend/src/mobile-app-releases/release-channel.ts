import { BadRequestException } from '@nestjs/common';
export type MobileApplication = 'collector' | 'operations';
export function releaseChannel(application: string = 'collector') {
  if (application !== 'collector' && application !== 'operations') throw new BadRequestException('قناة التطبيق غير صحيحة');
  return {
    application: application as MobileApplication,
    settingKey: application === 'operations' ? 'mobile.operations.releases' : 'mobile.app.releases',
    packageId: application === 'operations' ? 'com.alraqi.operations' : 'com.albinaa.collector',
  };
}
