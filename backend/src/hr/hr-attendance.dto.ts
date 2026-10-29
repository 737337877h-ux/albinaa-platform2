import { IsBoolean, IsIn, IsNumber, IsOptional, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
export class AttendanceQueryDto { @Matches(/^\d{4}-\d{2}-\d{2}$/) date!:string; }
export class AttendancePunchDto {
 @IsUUID() operationId!:string;
 @IsOptional() @IsNumber() recordedAt?:number;
 @IsOptional() @IsUUID() employeeId?:string;
 @IsIn(['in','break_out','break_in','out']) action!:string;
 @IsIn(['qr','location']) method!:string;
 @IsOptional() @MaxLength(1200) token?:string;
 @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?:number;
 @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?:number;
 @IsOptional() @IsNumber() @Min(0) @Max(10000) accuracy?:number;
 @IsOptional() @IsNumber() capturedAt?:number;
 @IsOptional() @IsBoolean() mocked?:boolean;
}
