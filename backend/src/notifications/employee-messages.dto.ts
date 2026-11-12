import {IsString,Length} from 'class-validator';
export class CustomerReminderDto {
  @IsString() @Length(8,80) operationId!:string;
}
export class StaffBroadcastDto extends CustomerReminderDto {
  @IsString() @Length(3,120) title!:string;
  @IsString() @Length(3,2000) message!:string;
}
