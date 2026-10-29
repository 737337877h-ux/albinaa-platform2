import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class EmployeeDto {
 @IsString() @Matches(/^\d{1,20}$/) employeeNo!: string;
 @IsString() @MinLength(2) @MaxLength(200) fullName!: string;
 @IsString() @MaxLength(200) jobTitle!: string;
 @IsOptional() @Matches(/^\d{1,20}$/) managerNo?: string | null;
 @IsBoolean() active!: boolean;
 @IsIn(['office','field','mixed']) workMode!: string;
 @IsBoolean() attendanceExempt!: boolean;
 @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime?: string | null;
 @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) endTime?: string | null;
  @IsInt() @Min(0) @Max(1440) breakMinutes!: number;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) breakStartTime?:string|null;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) breakEndTime?:string|null;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @ArrayUnique() @IsInt({each:true}) @Min(0,{each:true}) @Max(6,{each:true}) workDays!: number[];
 @IsString() @MaxLength(2000) notes!: string;
 @IsInt() @Min(0) version!: number;
}

export class SalaryDto {
 @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom!: string;
 @Matches(/^\d{1,12}(\.\d{1,2})?$/) baseSalary!: string;
 @IsOptional() @Matches(/^\d{1,12}(\.\d{1,2})?$/) fixedAllowance?: string | null;
 @IsIn(['YER','SAR','USD']) currency!: string;
 @IsInt() @Min(1) version!: number;
}
