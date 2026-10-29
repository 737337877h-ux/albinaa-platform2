import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class CreateHandoverVoucherDto {
  @ApiProperty({ type: [String], description: 'تحصيلات مسجلة لنفس المحصل والفرع والعملة' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('4', { each: true })
  collectionIds!: string[];
}
