import {IsBoolean,IsNumber,IsInt,IsString,Matches,Max,Min,MinLength,MaxLength} from 'class-validator';
export class TimePolicyDto {
 @IsInt() @Min(1) version!:number;
 @Matches(/^\d{4}-\d{2}-01$/) effectiveFrom!:string;
 @IsInt() @Min(0) @Max(60) graceMinutes!:number;
 @IsInt() @Min(0) @Max(60) returnGraceMinutes!:number;
 @IsInt() @Min(1) @Max(31) daysDivisor!:number;
 @IsInt() @Min(1) @Max(12) hoursDivisor!:number;
 @IsNumber({maxDecimalPlaces:2}) @Min(2.5) @Max(31) monthlyLeaveDays!:number;
 @IsBoolean() automaticAbsence!:boolean;
 @IsBoolean() lateDeduction!:boolean;
 @IsString() @MinLength(3) @MaxLength(500) reason!:string;
}
