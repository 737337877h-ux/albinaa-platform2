import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReverseCollectionDto {
  @ApiProperty({ description: 'سبب العكس — إلزامي (توثيق كامل)' })
  @IsString() @MinLength(3) @MaxLength(500)
  reason!: string;
}
