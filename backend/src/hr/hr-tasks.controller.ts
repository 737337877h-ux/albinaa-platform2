import {HrTaskAttachmentsService,TaskAttachmentDto} from './hr-task-attachments.service';
import {FileInterceptor} from '@nestjs/platform-express';
import {Body,Controller,Get,Param,ParseUUIDPipe,Post,Put,Delete,UploadedFile,UseInterceptors} from '@nestjs/common';
import {CurrentUser} from '../common/decorators/current-user.decorator';
import {RequirePermissions} from '../common/decorators/permissions.decorator';
import {AuthUser} from '../common/guards/jwt-auth.guard';
import {HrTasksService} from './hr-tasks.service';
import {HrTaskActionDto,HrTaskDto} from './hr-tasks.dto';
@Controller('hr/tasks')
export class HrTasksController {
 constructor(private readonly hr:HrTasksService,private readonly files:HrTaskAttachmentsService){}
 @Post('attachments') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:10*1024*1024,files:1}})) upload(@CurrentUser() u:AuthUser,@Body() d:TaskAttachmentDto,@UploadedFile() file:Express.Multer.File){return this.files.upload(u,d,file);}
 @Get('attachments/:id') download(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.files.download(u,id);}
 @Delete('attachments/:id') remove(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.files.removeDraft(u,id);}
 @Get('mine') async mine(@CurrentUser() u:AuthUser){return this.files.decorateMine(await this.hr.mine(u));}
 @Get() @RequirePermissions('hr.tasks.manage') async admin(@CurrentUser() u:AuthUser){return this.files.decorateAdmin(await this.hr.admin(u));}
 @Post() @RequirePermissions('hr.tasks.manage') create(@CurrentUser() u:AuthUser,@Body() d:HrTaskDto){return this.hr.create(u,d);}
 @Put(':id/action') action(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() d:HrTaskActionDto){return this.hr.action(u,id,d);}
}
