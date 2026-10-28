import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Param, Post, Query, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';

@Controller('quotations')
export class QuotationsController {
  constructor(private readonly config: ConfigService) {}

  @Get('capabilities')
  @RequirePermissions('sales_order_drafts.read')
  capabilities(@CurrentUser() actor: AuthUser) {
    return { draftScope: `${actor.organizationId}:${actor.id}`, createEnabled: this.config.get<string>('ORACLE_QUOTATIONS_WRITE_ENABLED') === 'true'
      && actor.organizationId === this.config.get<string>('ORACLE_QUOTATIONS_ORGANIZATION_ID')
      && actor.permissions.includes('sales_order_drafts.manage') };
  }

  private async write(actor: AuthUser, input: Record<string, unknown>, dryRun: boolean) {
    if (actor.organizationId !== this.config.get<string>('ORACLE_QUOTATIONS_ORGANIZATION_ID')) throw new ForbiddenException();
    if (this.config.get<string>('ORACLE_QUOTATIONS_WRITE_ENABLED') !== 'true') throw new ServiceUnavailableException('إنشاء عروض الأسعار غير مفعّل');
    const base = this.config.get<string>('ORACLE_QUOTATIONS_WRITE_API_URL')?.replace(/\/$/, '');
    const key = this.config.get<string>('ORACLE_QUOTATIONS_WRITE_API_KEY');
    if (!base || !key) throw new ServiceUnavailableException('بوابة حفظ عروض الأسعار غير مهيأة');
    if (!input || typeof input.externalReference !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.externalReference)) throw new BadRequestException('معرف الطلب غير صالح');
    let response: Response;
    try {
      response = await fetch(`${base}/sales/quotations${dryRun ? '/dry-run' : ''}`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, externalReference: `${actor.organizationId}:${input.externalReference}` }),
        signal: AbortSignal.timeout(120000),
      });
    } catch { throw new ServiceUnavailableException('تعذر تأكيد النتيجة؛ أعد المحاولة بنفس الطلب'); }
    if (response.status === 409) throw new ConflictException('يوجد حفظ آخر جارٍ؛ أعد المحاولة بنفس الطلب');
    if (response.status === 400) throw new BadRequestException('تعذر التحقق من بيانات العرض؛ راجع العميل والعملة والأصناف والخصومات');
    if (!response.ok) throw new ServiceUnavailableException('تعذر تأكيد حفظ العرض؛ أعد المحاولة بنفس الطلب');
    const body = await response.json();
    if (body.schema !== 'IAS20261' || (dryRun ? body.mode !== 'DRY_RUN' || body.oracleWrite !== 'NONE' || body.valid !== true : !/^\d{1,38}$/.test(body.serial || ''))) throw new ServiceUnavailableException('تعذر التحقق من استجابة الحفظ');
    return body;
  }

  @Post('dry-run')
  @RequirePermissions('sales_order_drafts.manage')
  preview(@CurrentUser() actor: AuthUser, @Body() input: Record<string, unknown>) { return this.write(actor, input, true); }

  @Post()
  @RequirePermissions('sales_order_drafts.manage')
  create(@CurrentUser() actor: AuthUser, @Body() input: Record<string, unknown>) { return this.write(actor, input, false); }

  private async read(actor: AuthUser, path: string) {
    const organization = this.config.get<string>('ORACLE_QUOTATIONS_ORGANIZATION_ID');
    const base = this.config.get<string>('ORACLE_READ_API_URL')?.replace(/\/$/, '');
    const key = this.config.get<string>('ORACLE_READ_API_KEY');
    if (!organization || !base || !key) throw new ServiceUnavailableException('ربط عروض الأسعار غير مهيأ');
    if (actor.organizationId !== organization) throw new ForbiddenException();
    try {
      const response = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error('Gateway unavailable');
      const body = await response.json();
      if (body.schema !== 'IAS20261' || body.mode !== 'SELECT_ONLY' || body.oracleWrite !== 'NONE') throw new Error('Invalid envelope');
      return body;
    } catch { throw new ServiceUnavailableException('تعذر قراءة عروض الأسعار من Oracle'); }
  }

  @Get()
  @RequirePermissions('sales_order_drafts.read')
  list(@CurrentUser() actor: AuthUser, @Query('search') search = '', @Query('afterSerial') afterSerial = '') {
    if (search.length > 100 || (afterSerial && !/^\d{1,38}$/.test(afterSerial))) throw new BadRequestException();
    const query = new URLSearchParams({ schema: 'IAS20261', limit: '25', search });
    if (afterSerial) query.set('afterSerial', afterSerial);
    return this.read(actor, `/quotations?${query}`);
  }

  @Get(':serial')
  @RequirePermissions('sales_order_drafts.read')
  detail(@CurrentUser() actor: AuthUser, @Param('serial') serial: string) {
    if (!/^\d{1,38}$/.test(serial)) throw new BadRequestException();
    return this.read(actor, `/quotations/${serial}?schema=IAS20261`);
  }
}
