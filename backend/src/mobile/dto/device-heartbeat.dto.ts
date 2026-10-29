import { IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class DeviceHeartbeatDto {
  @IsString() @MaxLength(120) deviceId!: string;
  @IsOptional() @IsString() @MaxLength(160) deviceName?: string;
  @IsString() @MaxLength(30) platform!: string;
  @IsOptional() @IsString() @MaxLength(30) appVersion?: string;
  @IsOptional() @IsISO8601() lastSyncedAt?: string;
  @IsOptional() @IsInt() @Min(0) @Max(300000) responseMs?: number;
}
