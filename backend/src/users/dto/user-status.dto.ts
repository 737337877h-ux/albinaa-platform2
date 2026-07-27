import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UserStatusDto {
  @ApiProperty({ description: 'true = تفعيل، false = تعطيل (لا يوجد حذف نهائي)' })
  @IsBoolean()
  isActive!: boolean;
}
