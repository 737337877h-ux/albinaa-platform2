import {Controller,Get,Post,Req,Res,ForbiddenException} from '@nestjs/common';import {Request,Response} from 'express';import {createHash,randomBytes} from 'crypto';
import {PrismaService} from '../prisma/prisma.service';import {Public} from '../common/decorators/public.decorator';import {RequirePermissions} from '../common/decorators/permissions.decorator';import {CurrentUser} from '../common/decorators/current-user.decorator';import {AuthUser} from '../common/guards/jwt-auth.guard';import {HrAttendanceService} from './hr-attendance.service';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
@Controller('hr/attendance/display')
export class HrAttendanceDisplayController {
 constructor(private readonly db:PrismaService,private readonly attendance:HrAttendanceService){}
 @Post('enable') @RequirePermissions('hr.attendance.qr') async enable(@CurrentUser() u:AuthUser,@Req() req:Request,@Res({passthrough:true}) res:Response){
  const token=randomBytes(32).toString('hex');await this.db.$transaction(async tx=>{const record=await tx.hrAttendanceDisplay.create({data:{organizationId:u.organizationId,createdBy:u.id,tokenHash:hash(token)}});await tx.auditLog.create({data:{userId:u.id,action:'hr_display_enabled',entityTable:'hr_attendance_displays',entityId:record.id,newValue:{organizationId:u.organizationId}}});});
  res.cookie('albinaa_hr_display',token,{httpOnly:true,sameSite:'strict',secure:req.secure,path:'/api/hr/attendance/display',maxAge:90*86400000});res.setHeader('Cache-Control','no-store');return {enabled:true};
 }
 @Post('revoke') @RequirePermissions('hr.attendance.qr') async revoke(@CurrentUser() u:AuthUser){await this.db.$transaction(async tx=>{await tx.hrAttendanceDisplay.updateMany({where:{organizationId:u.organizationId,revokedAt:null},data:{revokedAt:new Date()}});await tx.auditLog.create({data:{userId:u.id,action:'hr_displays_revoked',entityTable:'hr_attendance_displays',newValue:{organizationId:u.organizationId}}});});return {revoked:true};}
 @Get() @Public() async display(@Req() req:Request,@Res({passthrough:true}) res:Response){
  res.setHeader('Cache-Control','no-store');const token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('albinaa_hr_display='))?.slice('albinaa_hr_display='.length);
  if(!token||!/^[a-f0-9]{64}$/.test(token))throw new ForbiddenException('هذه الشاشة تحتاج تفعيلًا مرة واحدة من مسؤول الحضور');
  const d=await this.db.hrAttendanceDisplay.findUnique({where:{tokenHash:hash(token)}});if(!d||d.revokedAt||Date.now()-d.createdAt.getTime()>90*86400000)throw new ForbiddenException('انتهى أو ألغي تفعيل شاشة الحضور');
  return this.attendance.qr({organizationId:d.organizationId} as AuthUser);
 }
}
