import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsString, MaxLength, MinLength } from 'class-validator';

export class UpsertSettingDto {
  @ApiProperty({ example: 'company_name' })
  @IsString() @MinLength(2) @MaxLength(100)
  key!: string;

  @ApiProperty({ example: 'شركة الألبينة' })
  @IsDefined()
  value!: any;
}
