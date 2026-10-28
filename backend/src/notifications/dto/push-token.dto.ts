import { IsIn, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class PushTokenDto {
  @IsString()
  @Matches(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/)
  token!: string;

  @IsIn(['android', 'ios'])
  platform!: 'android' | 'ios';

  @IsOptional()
  @IsIn(['com.albinaa.collector', 'com.alraqi.operations'])
  applicationId?: string;

  @IsOptional()
  @IsIn(['albinaa-reminders', 'alraqi-operations-sms-v1', 'albinaa-collection-created-v1'])
  notificationChannelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}

export class RemovePushTokenDto {
  @IsString()
  @Matches(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/)
  token!: string;
}
