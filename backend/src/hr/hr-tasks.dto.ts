import {ArrayMaxSize,ArrayMinSize,ArrayUnique,IsArray,IsIn,IsInt,IsOptional,IsString,IsUUID,Matches,Max,MaxLength,Min,MinLength} from 'class-validator';
export class HrTaskDto {
 @IsOptional() @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) attachmentIds?:string[];
 @IsUUID() id!:string;
 @IsString() @MinLength(3) @MaxLength(200) title!:string;
 @IsString() @MaxLength(4000) description!:string;
 @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ArrayUnique() @IsUUID('all',{each:true}) employeeIds!:string[];
}
export class HrTaskActionDto {
 @IsOptional() @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsUUID('all',{each:true}) attachmentIds?:string[];
 @IsUUID() operationId!:string;
 @IsIn(['submit','complete','return','cancel']) action!:string;
 @IsString() @MinLength(3) @MaxLength(4000) note!:string;
 @IsOptional() @IsInt() @Min(1) @Max(5) rating?:number;
 @IsInt() @Min(1) version!:number;
}
