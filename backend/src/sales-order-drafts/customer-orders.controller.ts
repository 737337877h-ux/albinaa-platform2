import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Post, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { SalesOrderDraftsService } from './sales-order-drafts.service';

@Controller('customer-orders')
export class CustomerOrdersController {
  constructor(private readonly config: ConfigService, private readonly drafts: SalesOrderDraftsService) {}

  @Get('capabilities')
  @RequirePermissions('sales_order_drafts.read')
  capabilities(@CurrentUser() actor: AuthUser) {
    return { draftScope: `${actor.organizationId}:${actor.id}`, schema: 'IAS20261', kinds: ['cash','credit'],
      createEnabled: this.config.get('ORACLE_SALES_ORDERS_WRITE_ENABLED') === 'true'
        && actor.organizationId === this.config.get('ORACLE_SALES_ORDERS_ORGANIZATION_ID')
        && actor.permissions.includes('sales_order_drafts.manage') };
  }

  private async write(actor: AuthUser, input: Record<string, unknown>, dryRun: boolean) {
    if (actor.organizationId !== this.config.get('ORACLE_SALES_ORDERS_ORGANIZATION_ID')) throw new ForbiddenException();
    if (this.config.get('ORACLE_SALES_ORDERS_WRITE_ENABLED') !== 'true') throw new ServiceUnavailableException('حفظ طلبات Oracle غير مفعّل');
    const base = this.config.get<string>('ORACLE_SALES_ORDERS_WRITE_API_URL')?.replace(/\/$/, '');
    const key = this.config.get<string>('ORACLE_SALES_ORDERS_WRITE_API_KEY');
    if (!base || !key) throw new ServiceUnavailableException('بوابة طلبات العملاء غير مهيأة');
    if (!input || typeof input.externalReference !== 'string' || !/^[a-zA-Z0-9:_-]{8,80}$/.test(input.externalReference)) throw new BadRequestException('مرجع الطلب غير صالح');
    let response: Response;
    try {
      response = await fetch(`${base}/sales/customer-orders${dryRun ? '/dry-run' : ''}`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, externalReference: `${actor.organizationId}:${input.externalReference}` }),
        signal: AbortSignal.timeout(120000),
      });
    } catch { throw new ServiceUnavailableException('تعذر تأكيد النتيجة؛ أعد إرسال نفس الطلب دون إنشاء طلب جديد'); }
    if (response.status === 409) throw new ConflictException('أعد المحاولة بنفس الطلب؛ مرجعه أو الترقيم مشغول');
    if (response.status === 400) {
      const error = await response.json().catch(() => ({}));
      throw new BadRequestException(typeof error.message === 'string' ? error.message.slice(0,1200) : 'راجع بيانات الطلب');
    }
    if (!response.ok) throw new ServiceUnavailableException('تعذر تأكيد حفظ الطلب؛ أعد المحاولة بنفس المرجع');
    const body = await response.json();
    if (body.schema !== 'IAS20261' || (dryRun ? body.mode !== 'DRY_RUN' || body.oracleWrite !== 'NONE' || body.valid !== true
      : typeof body.serial !== 'string' || !/^\d{1,38}$/.test(body.serial))) throw new ServiceUnavailableException('استجابة الحفظ غير صالحة');
    if (dryRun) return body;
    try { return { ...await this.drafts.mirrorCreatedOrder(actor, body.serial), oracleCreated: body.created, oracleWrite: 'SAVED' }; }
    catch { throw new ServiceUnavailableException('حُفظ طلب Oracle وتعذّر تحديث عرض المنصة؛ أعد المحاولة بنفس الطلب لاسترجاعه دون تكرار'); }
  }
  @Post('dry-run')
  @RequirePermissions('sales_order_drafts.manage')
  preview(@CurrentUser() actor: AuthUser, @Body() input: Record<string, unknown>) { return this.write(actor,input,true); }
  @Post()
  @RequirePermissions('sales_order_drafts.manage')
  create(@CurrentUser() actor: AuthUser, @Body() input: Record<string, unknown>) { return this.write(actor,input,false); }
}
