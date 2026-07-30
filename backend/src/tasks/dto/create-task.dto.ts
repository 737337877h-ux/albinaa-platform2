import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateTaskDto {
  @IsUUID()
  customerId!: string;

  @IsString()
  taskType!: string;

  @IsDateString()
  dueDate!: string;

  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  priorityReason?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedAmount?: number;

  @IsOptional()
  @IsString()
  expectedCurrency?: string;
}
