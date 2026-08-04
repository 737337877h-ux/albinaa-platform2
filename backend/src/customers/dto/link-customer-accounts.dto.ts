import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class LinkCustomerAccountsDto {
  @ApiProperty({
    type: [String],
    description: 'الحسابات المستقلة التي ستُربط دفعة واحدة مع بقاء حركاتها منفصلة',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  childCustomerIds!: string[];
}
