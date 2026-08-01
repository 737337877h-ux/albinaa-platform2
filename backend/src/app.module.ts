import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { BranchesModule } from './branches/branches.module';
import { AuditModule } from './audit/audit.module';
import { ImportsModule } from './imports/imports.module';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FollowupsModule } from './followups/followups.module';
import { PromisesModule } from './promises/promises.module';
import { CollectionsModule } from './collections/collections.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { TasksModule } from './tasks/tasks.module';
import { CurrenciesModule } from './currencies/currencies.module';
import { SettingsModule } from './settings/settings.module';
import { CollectorsModule } from './collectors/collectors.module';
import { MobileModule } from './mobile/mobile.module';
import { RiskModule } from './risk/risk.module';
import { ReservationsModule } from './reservations/reservations.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // حد عام: 100 طلب/دقيقة لكل IP — وحد أشد على /auth/login عبر @Throttle
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuditModule,
    HealthModule,
    AuthModule,
    UsersModule,
    RolesModule,
    BranchesModule,
    ImportsModule,
    CustomersModule,
    DashboardModule,
    NotificationsModule,
    FollowupsModule,
    PromisesModule,
    CollectionsModule,
    AssignmentsModule,
    TasksModule,
    CurrenciesModule,
    SettingsModule,
    CollectorsModule,
    MobileModule,
    RiskModule,
    ReservationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },         // 1) Rate limiting
    { provide: APP_GUARD, useClass: JwtAuthGuard },           // 2) مصادقة JWT (مع @Public)
    { provide: APP_GUARD, useClass: RolesGuard },             // 3) أدوار
    { provide: APP_GUARD, useClass: PermissionsGuard },       // 4) صلاحيات دقيقة
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }, // 5) Idempotency
  ],
})
export class AppModule {}
