import {IsIn,IsInt,IsOptional,IsString,Matches,MaxLength,Min,MinLength,IsUUID} from 'class-validator';
export class HrProfileDto {
 @IsInt() @Min(1) version!:number;
 @IsOptional() @IsString() @MaxLength(40) phone?:string;
 @IsOptional() @IsString() @MaxLength(50) nationalId?:string;
 @IsOptional() @IsString() @MaxLength(100) department?:string;
 @IsOptional() @IsUUID() branchId?:string|null;
 @IsOptional() @IsIn(['permanent','fixed','temporary','probation','unspecified']) contractType?:string;
 @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) joinDate?:string|null;
 @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) contractEnd?:string|null;
 @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) probationEnd?:string|null;
 @IsOptional() @IsString() @MaxLength(100) bankName?:string;
 @IsOptional() @IsString() @MaxLength(100) bankAccount?:string;
 @IsOptional() @IsString() @MaxLength(100) insuranceNo?:string;
 @IsOptional() @Matches(/^\d{1,3}(\.5)?$/) leaveOpeningDays?:string|null;
 @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) leaveAsOf?:string|null;
}
export class HrActiveDto { @IsIn(['active','inactive']) status!:string; @IsInt() @Min(1) version!:number; @IsString() @MinLength(3) @MaxLength(500) reason!:string; }
export class HrAbsenceDto { @Matches(/^\d{4}-\d{2}-\d{2}$/) date!:string; @IsIn(['confirmed','excused']) status!:string; @IsString() @MinLength(3) @MaxLength(500) reason!:string; @IsInt() @Min(0) version!:number; }
