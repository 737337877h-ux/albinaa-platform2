import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class LinkCustomerAccountDto {
  @ApiProperty({ description: 'Customer that will remain separate and appear as a sub-account' })
  @IsUUID()
  childCustomerId!: string;
}
