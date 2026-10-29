import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
export class HrRequestDto {
 @IsUUID() id!:string;
 @IsIn(['advance','leave']) kind!:string;
 @IsString() @MinLength(3) @MaxLength(1500) reason!:string;
 @IsOptional() @Matches(/^\d{1,12}(\.\d{1,2})?$/) amount?:string;
 @IsOptional() @IsIn(['YER','SAR','USD']) currency?:string;
 @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?:string;
 @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate?:string;
 @IsOptional() @IsIn(['annual','sick','unpaid','other']) leaveType?:string;
}
export class HrDecisionDto {
 @IsOptional() @Matches(/^\d{1,12}(\.\d{1,2})?$/) monthlyInstallment?:string;
 @IsOptional() @Matches(/^2026-(10|11|12)$/) installmentStartMonth?:string;
 @IsIn(['approved','rejected','cancelled']) status!:string;
 @IsString() @MinLength(3) @MaxLength(1500) reason!:string;
 @IsInt() @Min(1) version!:number;
}
export class HrLoginDto {
 @IsOptional() @IsUUID() userId?:string|null;
 @IsInt() @Min(1) version!:number;
}
