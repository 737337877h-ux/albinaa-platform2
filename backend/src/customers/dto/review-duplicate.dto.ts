import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class ReviewDuplicateDto {
  @ApiProperty({
    enum: ['rejected_intentional'],
    description: 'قرار المراجعة. الدمج (merged) غير متاح عبر API في هذه المرحلة — إجراء يدوي موثق فقط، حفاظًا على السجلات المالية',
  })
  @IsIn(['rejected_intentional'])
  decision!: 'rejected_intentional';
}
