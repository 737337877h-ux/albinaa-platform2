import {Body,Controller,Get,Param,ParseUUIDPipe,Post,Put,Query,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {CurrentUser} from '../common/decorators/current-user.decorator';
import {RequirePermissions} from '../common/decorators/permissions.decorator';
import {AuthUser} from '../common/guards/jwt-auth.guard';
import {HrProfileService} from './hr-profile.service';
import {HrActiveDto,HrProfileDto} from './hr-profile.dto';
import {adenDate} from './hr-attendance.service';
import {Workbook} from 'exceljs';
@Controller('hr/personnel')
export class HrProfileController {
 constructor(private readonly service:HrProfileService){}
 @Get() @RequirePermissions('hr.read') roster(@CurrentUser() u:AuthUser){return this.service.roster(u);}
 @Get('cockpit') @RequirePermissions('hr.read') cockpit(@CurrentUser() u:AuthUser){return this.service.cockpit(u);}
 @Get('export') @RequirePermissions('hr.read') async export(@CurrentUser() u:AuthUser){const r=await this.service.roster(u);const w=new Workbook(),s=w.addWorksheet('الموظفون',{views:[{rightToLeft:true}]});const financial=u.permissions.includes('hr.salary.read');s.addRow(['الكود','الاسم','الوظيفة','القسم','الهاتف','الحالة',...(financial?['الأساسي (آخر راتب مسجل)','البدل الثابت','العملة','سريان الراتب']:[])]);for(const e of r.employees){const p=e.profile??{},salary=e.salaries?.[0];s.addRow([e.employeeNo,e.fullName,e.jobTitle,p.department??'',p.phone??'',e.active?'نشط':'غير نشط',...(financial?[salary?.baseSalary?.toString()??'',salary?.fixedAllowance?.toString()??'',salary?.currency??'',salary?.effectiveFrom?.toISOString().slice(0,10)??'']:[])]);}s.getRow(1).font={bold:true};s.columns.forEach(c=>c.width=24);return {name:'employees.xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:Buffer.from(await w.xlsx.writeBuffer()).toString('base64')};}
 @Get(':id') @RequirePermissions('hr.read') detail(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Query('month') month?:string){return this.service.detail(u,id,month??adenDate(new Date()).slice(0,7));}
 @Put(':id/profile') @RequirePermissions('hr.read','hr.manage') profile(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() d:HrProfileDto){return this.service.profile(u,id,d);}
 @Put(':id/status') @RequirePermissions('hr.read','hr.manage') status(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() d:HrActiveDto){return this.service.active(u,id,d);}
 @Post(':id/documents') @RequirePermissions('hr.read','hr.manage') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5*1024*1024,files:1}})) document(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@UploadedFile() file:Express.Multer.File,@Body('expiresOn') expires?:string){return this.service.document(u,id,file,expires);}
 @Get(':id/documents/:documentId') @RequirePermissions('hr.read') async download(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Param('documentId',ParseUUIDPipe) doc:string){const d=await this.service.download(u,id,doc);return {name:d.name,mime:d.mime,base64:Buffer.from(d.content).toString('base64')};}
}
