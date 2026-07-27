import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class BranchStatusDto {
  @ApiProperty({ description: 'true = نشط، false = موقوف' })
  @IsBoolean()
  active!: boolean;
}
