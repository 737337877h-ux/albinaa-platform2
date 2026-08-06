import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CampaignDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsIn(['whatsapp', 'sms'])
  channel!: 'whatsapp' | 'sms';

  @IsString()
  @MaxLength(80)
  templateId!: string;

  @IsString()
  @MaxLength(2000)
  messageBody!: string;

  @IsIn(['bucket_31_60', 'bucket_61_90', 'bucket_91_120', 'bucket_120_plus'])
  agingBucket!: 'bucket_31_60' | 'bucket_61_90' | 'bucket_91_120' | 'bucket_120_plus';

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}
