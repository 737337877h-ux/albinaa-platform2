import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateAssignmentChangeRequestDto {
  @ApiProperty()
  @IsUUID()
  customerId!: string;

  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ description: 'المحصل البديل المقترح، إن كان معروفًا لمقدم الطلب' })
  @IsOptional()
  @IsUUID()
  requestedCollectorId?: string;
}
