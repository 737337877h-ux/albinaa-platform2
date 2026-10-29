import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SmartAssignmentDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  customerIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
