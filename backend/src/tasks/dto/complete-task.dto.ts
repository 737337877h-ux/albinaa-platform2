import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** نتائج إكمال المهمة المعتمدة (PR 9) — تُسجَّل كنتيجة متابعة في followups. */
export const TASK_COMPLETE_RESULTS = [
  'contacted',   // تواصل ناجح
  'no_answer',   // لا يرد
  'promise',     // وعد بالسداد
  'needs_visit', // يحتاج زيارة
  'deferred',    // مؤجل
  'note',        // ملاحظة
] as const;

export type TaskCompleteResult = (typeof TASK_COMPLETE_RESULTS)[number];

/** الاسم العربي المعتمد لكل نتيجة — يُحلّ إلى سجل followup_results (upsert عند غيابه). */
export const TASK_COMPLETE_RESULT_LABELS: Record<TaskCompleteResult, string> = {
  contacted: 'تواصل ناجح',
  no_answer: 'لا يرد',
  promise: 'وعد بالسداد',
  needs_visit: 'يحتاج زيارة',
  deferred: 'مؤجل',
  note: 'ملاحظة',
};

export class CompleteTaskDto {
  @ApiPropertyOptional({
    description: 'النتيجة — افتراضي: note (ملاحظة)',
    enum: TASK_COMPLETE_RESULTS,
  })
  @IsOptional() @IsIn(TASK_COMPLETE_RESULTS)
  result?: TaskCompleteResult;

  @ApiPropertyOptional({ description: 'ملاحظات الإكمال' })
  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'موعد المتابعة القادمة (اختياري)' })
  @IsOptional() @IsDateString()
  nextFollowupDate?: string;

  @ApiPropertyOptional({
    description: 'تاريخ استحقاق الوعد — مطلوب عند result=promise',
  })
  @IsOptional() @IsDateString()
  promiseDueDate?: string;

  @ApiPropertyOptional({
    description: 'مبلغ الوعد — افتراضي: المبلغ المتوقع للمهمة',
  })
  @IsOptional() @IsNumber() @Min(0.01)
  promiseAmount?: number;

  @ApiPropertyOptional({ example: 'YER', description: 'عملة الوعد — افتراضي: عملة المهمة' })
  @IsOptional() @IsString() @MaxLength(3)
  promiseCurrency?: string;
}
