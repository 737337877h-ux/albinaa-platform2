import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsPositive, IsString, Length, Max } from 'class-validator';

export class CreateFinancialAdjustmentRequestDto {
  @ApiProperty({ enum: ['discount', 'settlement'] })
  @IsIn(['discount', 'settlement'])
  requestType!: 'discount' | 'settlement';

  @ApiProperty({ example: 'YER' })
  @IsString()
  @Length(3, 3)
  currencyCode!: string;

  @ApiProperty({ example: 5000 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  @Max(99999999999999)
  requestedAmount!: number;

  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @Length(5, 500)
  reason!: string;
}
