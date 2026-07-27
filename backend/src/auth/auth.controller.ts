import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** حد أشد على تسجيل الدخول: 5 محاولات في الدقيقة لكل IP. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'تسجيل الدخول — يعيد Access + Refresh Tokens' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.username, dto.password, req);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'تجديد التوكن (مع تدوير Refresh Token)' })
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, req);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'تسجيل الخروج — يُبطل جلسة الـ Refresh Token' })
  logout(@Body() dto: RefreshDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.auth.logout(dto.refreshToken, user.id, req);
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'الملف الشخصي + الأدوار + الصلاحيات' })
  me(@CurrentUser() user: AuthUser) {
    return user; // مبني في الحارس من القاعدة — بدون password_hash
  }

  @Post('change-password')
  @HttpCode(200)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'تغيير كلمة المرور — يُبطل كل الجلسات' })
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword, req);
  }
}
