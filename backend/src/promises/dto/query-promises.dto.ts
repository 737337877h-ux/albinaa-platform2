import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class QueryPromisesDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    enum: ['upcoming', 'due_today', 'fulfilled', 'partially_fulfilled', 'unfulfilled', 'postponed', 'cancelled_approved'],
  })
  @IsOptional()
  @IsIn(['upcoming', 'due_today', 'fulfilled', 'partially_fulfilled', 'unfulfilled', 'postponed', 'cancelled_approved'])
  status?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  dueFrom?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  dueTo?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
