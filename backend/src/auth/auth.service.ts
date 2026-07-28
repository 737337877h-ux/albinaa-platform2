import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  private accessTtl() { return Number(process.env.JWT_ACCESS_TTL ?? 900); }
  private refreshTtl() { return Number(process.env.JWT_REFRESH_TTL ?? 604800); }

  private async issueTokens(userId: string, req?: Request, replacedSessionId?: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: this.accessTtl() },
    );
    const refreshToken = this.passwords.generateRefreshToken();

    // ── Max sessions per user: revoke oldest active sessions ──
    const maxSessions = Number(process.env.MAX_SESSIONS_PER_USER ?? 5);
    const activeSessions = await this.prisma.authSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (activeSessions.length >= maxSessions) {
      const toRevoke = activeSessions.slice(0, activeSessions.length - maxSessions + 1);
      await this.prisma.authSession.updateMany({
        where: { id: { in: toRevoke.map((s) => s.id) } },
        data: { revokedAt: new Date(), replacedById: null },
      });
    }

    const session = await this.prisma.authSession.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),          // لا يُخزَّن التوكن الخام أبدًا
        expiresAt: new Date(Date.now() + this.refreshTtl() * 1000),
        ipAddress: req?.ip ?? null,
        userAgent: (req?.headers['user-agent'] as string) ?? null,
      },
    });
    if (replacedSessionId) {
      await this.prisma.authSession.update({
        where: { id: replacedSessionId },
        data: { revokedAt: new Date(), replacedById: session.id },
      });
    }
    return { accessToken, refreshToken, expiresIn: this.accessTtl() };
  }

  /** رسالة موحدة لفشل الدخول — لا تكشف هل المستخدم موجود أم كلمة المرور خاطئة. */
  private failLogin(): never {
    throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة');
  }

  async login(username: string, password: string, req?: Request) {
    const user = await this.prisma.user.findFirst({ where: { username } });

    if (!user) {
      await this.audit.log({
        action: 'login_failed', entityTable: 'auth', reason: 'unknown_username', req,
        newValue: { username },
      });
      this.failLogin();
    }
    if (!user.isActive) {
      await this.audit.log({
        userId: user.id, action: 'login_failed', entityTable: 'auth',
        reason: 'user_disabled', req,
      });
      this.failLogin(); // نفس الرسالة — لا نكشف أن الحساب معطل
    }

    const { ok, needsRehash } = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      await this.audit.log({
        userId: user.id, action: 'login_failed', entityTable: 'auth',
        reason: 'wrong_password', req,
      });
      this.failLogin();
    }

    const updates: Record<string, unknown> = { lastLoginAt: new Date() };
    if (needsRehash) updates.passwordHash = await this.passwords.hash(password); // ترقية scrypt→Argon2
    await this.prisma.user.update({ where: { id: user.id }, data: updates });

    await this.audit.log({ userId: user.id, action: 'login_success', entityTable: 'auth', req });

    const tokens = await this.issueTokens(user.id, req);
    return {
      ...tokens,
      user: { id: user.id, username: user.username, fullName: user.fullName }, // لا hash أبدًا
    };
  }

  async refresh(refreshToken: string, req?: Request) {
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh Token غير صالح أو منتهي');
    }
    if (!session.user.isActive) {
      throw new UnauthorizedException('الحساب معطّل');
    }
    // تدوير التوكن: الجلسة القديمة تُبطل وتُستبدل بجديدة
    return this.issueTokens(session.userId, req, session.id);
  }

  async logout(refreshToken: string, userId: string, req?: Request) {
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (session && session.userId === userId && !session.revokedAt) {
      await this.prisma.authSession.update({
        where: { id: session.id }, data: { revokedAt: new Date() },
      });
    }
    await this.audit.log({ userId, action: 'logout', entityTable: 'auth', req });
    return { message: 'تم تسجيل الخروج' };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, req?: Request) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { ok } = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!ok) throw new UnauthorizedException('كلمة المرور الحالية غير صحيحة');

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(newPassword) },
    });
    // إبطال كل الجلسات القائمة بعد تغيير كلمة المرور
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.log({ userId, action: 'password_changed', entityTable: 'users', entityId: userId, req });
    return { message: 'تم تغيير كلمة المرور — سجّل الدخول من جديد' };
  }
}
