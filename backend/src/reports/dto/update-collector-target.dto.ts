import { IsDateString, IsNumber, Min } from 'class-validator';

export class UpdateCollectorTargetDto {
  @IsDateString() month!: string;
  @IsNumber() @Min(0) targetAmount!: number;
}
