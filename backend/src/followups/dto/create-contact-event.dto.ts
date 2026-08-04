import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateContactEventDto {
  @ApiProperty() @IsUUID()
  customerId!: string;

  @ApiProperty({ enum: ['whatsapp', 'sms'] }) @IsIn(['whatsapp', 'sms'])
  channel!: 'whatsapp' | 'sms';

  @ApiProperty() @IsString() @MaxLength(2000)
  message!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  templateId?: string;
}
