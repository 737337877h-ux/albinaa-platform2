import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SyncRequestDto {
  @ApiPropertyOptional({ description: 'آخر token تمت مزامنته' })
  @IsOptional() @IsString()
  lastSyncToken?: string;
}
