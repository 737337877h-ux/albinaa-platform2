import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class CustomerStatusDto {
  @ApiProperty({ enum: ['active', 'inactive'] })
  @IsIn(['active', 'inactive'])
  status!: 'active' | 'inactive';
}
