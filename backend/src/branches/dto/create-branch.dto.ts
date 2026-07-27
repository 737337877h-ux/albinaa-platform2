import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBranchDto {
  @ApiProperty({ example: 'فرع تعز' })
  @IsString() @MinLength(2) @MaxLength(200)
  name!: string;
}
