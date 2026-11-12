import {Type} from 'class-transformer';
import {IsIn,IsInt,IsOptional,IsString,IsUUID,Max,MaxLength,Min,ValidateIf} from 'class-validator';

export class MissingPhonesDto {
 @IsOptional() @IsString() @MaxLength(200) search?:string;
 @IsOptional() @ValidateIf((_,value)=>value!=='unassigned') @IsUUID() collectorId?:string;
 @IsOptional() @IsIn(['customer','advance']) accountClass?:'customer'|'advance';
 @IsOptional() @IsIn(['active','inactive','all']) status?:'active'|'inactive'|'all';
 @IsOptional() @Type(()=>Number) @IsInt() @Min(1) page?:number;
 @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100) limit?:number;
}
