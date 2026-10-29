import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
export class HrPeriodDto {
 @Matches(/^2026-(10|11|12)$/) month!:string;
 @IsOptional() @IsIn(['salary','custody']) kind?:'salary'|'custody';
 @IsOptional() @Matches(/^\d{1,20}$/) detail?:string;
}
export class MovementReviewDto {
 @Matches(/^[a-f0-9]{64}$/) id!:string;
 @IsIn(['deduct','exclude','installment']) action!:'deduct'|'exclude'|'installment';
 @IsString() @MaxLength(300) reason!:string;
 @IsOptional() @IsUUID() advanceRequestId?:string;
}
export class PayrollInputDto {
 @IsOptional() @Matches(/^\d{1,12}(\.\d{1,2})?$/) incentives?:string|null;
 @IsOptional() @Matches(/^\d{1,12}(\.\d{1,2})?$/) deductions?:string|null;
 @IsOptional() @Matches(/^\d{1,12}(\.\d{1,2})?$/) installments?:string|null;
 @IsBoolean() installmentsConfirmed!:boolean;
 @IsOptional() @IsString() @MaxLength(500) incentivesReason?:string;
 @IsOptional() @IsString() @MaxLength(500) deductionsReason?:string;
 @IsOptional() @IsString() @MaxLength(500) installmentsReason?:string;
 @IsArray() @ArrayMaxSize(5000) @ValidateNested({each:true}) @Type(()=>MovementReviewDto) reviews!:MovementReviewDto[];
 @IsString() @MaxLength(2000) notes!:string;
}
export class SavePayrollDto extends PayrollInputDto {
 @Matches(/^[a-f0-9]{64}$/) snapshotHash!:string;
 @IsInt() @Min(0) version!:number;
}
export class ApprovePayrollDto {
 @IsUUID() operationId!:string;
 @Matches(/^[a-f0-9]{64}$/) reviewHash!:string;
 @IsString() @MaxLength(1000) reason!:string;
}
export class ReopenPayrollDto {
 @IsUUID() operationId!:string;
 @IsUUID() approvalId!:string;
 @IsInt() @Min(1) version!:number;
 @IsString() @MaxLength(1000) reason!:string;
}
