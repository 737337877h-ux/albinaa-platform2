import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive } from 'class-validator';

export class IssueReservationDto {
  @ApiProperty({ description: 'Quantity to issue now (must not exceed remaining quantity)' })
  @IsNumber() @IsPositive()
  qty!: number;
}
