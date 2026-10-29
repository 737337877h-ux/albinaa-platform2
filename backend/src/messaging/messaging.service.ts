import { Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { AgingService } from '../aging/aging.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignDto } from './dto/campaign.dto';

const BUCKET_DAYS: Record<CampaignDto['agingBucket'], number> = {
  bucket_31_60: 30, bucket_61_90: 60, bucket_91_120: 90, bucket_120_plus: 120,
};
const DEBT_DISPLAY_LIMITS: Record<string, number> = { YER: 3000, SAR: 30, USD: 5 };
const CURRENCY_NAMES: Record<string, string> = {
  YER: 'ريال يمني', SAR: 'ريال سعودي', USD: 'دولار أمريكي',
};

function formatBalances(items: { currency: string; balance: number }[]) {
  return items
    .map((item) => `${item.balance.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${CURRENCY_NAMES[item.currency] ?? item.currency}`)
    .join(' + ');
}

function cleanPhone(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/[^0-9+]/g, '').replace(/^00/, '+');
  return normalized.length >= 7 ? normalized : null;
}

function render(body: string, values: Record<string, string>) {
  const aliases: Record<string, string> = {
    'اسم_العميل': 'customerName', 'الرصيد': 'balance', 'العملة': 'currency',
    'أقدم_دين_بالأيام': 'debtAgeDays', 'اسم_المحصل': 'collectorName',
  };
  return body.replace(/\{([^{}]+)\}/g, (token, key: string) => values[aliases[key] ?? key] ?? token);
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aging: AgingService,
    private readonly audit: AuditService,
  ) {}

  private async recipients(actor: AuthUser, dto: CampaignDto) {
    const report = await this.aging.report(actor, {
      accountClass: 'customer', currency: dto.currency || undefined, bucket: dto.agingBucket,
    });
    const rows = report.customers.filter((row) => Number(row.totalDue) > (DEBT_DISPLAY_LIMITS[row.currency] ?? 0.00005));
    const ids = [...new Set(rows.map((row) => String(row.customerId)))];
    const customers = ids.length ? await this.prisma.customer.findMany({
      where: { id: { in: ids }, organizationId: actor.organizationId, status: 'active' },
      select: {
        id: true, name: true, externalCustomerCode: true, phonePrimary: true, phoneSecondary: true, whatsapp: true,
        assignments: { where: { effectiveTo: null }, take: 1, include: { collector: { include: { user: { select: { fullName: true } } } } } },
      },
    }) : [];
    const byId = new Map(customers.map((customer) => [customer.id, customer]));
    const grouped = new Map<string, { customerId: string; customerName: string; customerCode: string | null; balances: { currency: string; balance: number }[] }>();
    for (const row of rows) {
      const customerId = String(row.customerId);
      const current = grouped.get(customerId) ?? {
        customerId,
        customerName: String(row.customerName),
        customerCode: row.customerCode == null ? null : String(row.customerCode),
        balances: [],
      };
      const existing = current.balances.find((item) => item.currency === row.currency);
      if (existing) existing.balance += Number(row.totalDue);
      else current.balances.push({ currency: row.currency, balance: Number(row.totalDue) });
      grouped.set(customerId, current);
    }
    return [...grouped.values()].map((group) => {
      const customer = byId.get(group.customerId);
      const destination = cleanPhone(dto.channel === 'whatsapp'
        ? customer?.whatsapp ?? customer?.phonePrimary ?? customer?.phoneSecondary
        : customer?.phonePrimary ?? customer?.phoneSecondary ?? customer?.whatsapp);
      const balanceText = formatBalances(group.balances);
      const message = render(dto.messageBody, {
        customerName: customer?.name ?? group.customerName,
        customerCode: customer?.externalCustomerCode ?? group.customerCode ?? '—',
        balance: balanceText,
        currency: '',
        debtAgeDays: String(BUCKET_DAYS[dto.agingBucket]),
        companyName: 'البناء الراقي',
        collectorName: customer?.assignments[0]?.collector.user.fullName ?? 'فريق التحصيل',
      });
      return {
        customerId: group.customerId, customerName: customer?.name ?? group.customerName,
        customerCode: customer?.externalCustomerCode ?? group.customerCode,
        currency: group.balances.length === 1 ? group.balances[0].currency : 'MULTI',
        balance: group.balances[0]?.balance ?? 0, balances: group.balances, destination, message,
      };
    }).sort((a, b) => b.balances.length - a.balances.length || b.balance - a.balance);
  }

  async preview(actor: AuthUser, dto: CampaignDto) {
    const recipients = await this.recipients(actor, dto);
    return {
      totalCount: recipients.length,
      readyCount: recipients.filter((item) => item.destination).length,
      skippedCount: recipients.filter((item) => !item.destination).length,
      totalByCurrency: recipients.reduce<Record<string, number>>((totals, item) => {
        for (const balance of item.balances) totals[balance.currency] = (totals[balance.currency] ?? 0) + balance.balance;
        return totals;
      }, {}),
      sample: recipients.slice(0, 10),
    };
  }

  async create(actor: AuthUser, dto: CampaignDto, req: Request) {
    const recipients = await this.recipients(actor, dto);
    const [providerSetting] = await Promise.all([
      this.prisma.systemSetting.findUnique({ where: { organizationId_key: { organizationId: actor.organizationId, key: 'messaging.provider' } } }),
    ]);
    const provider = typeof providerSetting?.value === 'string' ? providerSetting.value : 'none';
    const readyCount = recipients.filter((item) => item.destination).length;
    const campaign = await this.prisma.$transaction(async (tx) => {
      const created = await tx.messageCampaign.create({
        data: {
          organizationId: actor.organizationId, createdBy: actor.id, name: dto.name.trim(),
          channel: dto.channel, templateId: dto.templateId, agingBucket: dto.agingBucket,
          currencyCode: dto.currency ?? null, provider, status: 'prepared',
          totalCount: recipients.length, readyCount, skippedCount: recipients.length - readyCount,
        },
      });
      if (recipients.length) await tx.messageDispatch.createMany({
        data: recipients.map((item) => ({
          campaignId: created.id, customerId: item.customerId, destination: item.destination,
          renderedMessage: item.message, status: item.destination ? 'prepared' : 'skipped_no_phone',
          errorMessage: item.destination ? null : 'لا يوجد رقم صالح للقناة المحددة',
        })),
      });
      return created;
    });
    await this.audit.log({
      userId: actor.id, action: 'message_campaign_prepared', entityTable: 'message_campaigns', entityId: campaign.id,
      newValue: { ...dto, messageBody: '[template body stored in dispatches]', totalCount: recipients.length, readyCount, provider }, req,
    });
    return { ...campaign, externalSendingEnabled: false, note: 'تم تجهيز سجل الإرسال. الإرسال الخارجي يبقى متوقفًا حتى ربط مزود رسمي.' };
  }

  async list(actor: AuthUser) {
    return this.prisma.messageCampaign.findMany({
      where: { organizationId: actor.organizationId }, orderBy: { createdAt: 'desc' }, take: 50,
      include: { creator: { select: { fullName: true } } },
    });
  }

  async detail(actor: AuthUser, id: string) {
    const campaign = await this.prisma.messageCampaign.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: {
        creator: { select: { fullName: true } },
        dispatches: { orderBy: { createdAt: 'asc' }, include: { customer: { select: { name: true, externalCustomerCode: true } } } },
      },
    });
    if (!campaign) throw new NotFoundException('الحملة غير موجودة');
    return {
      ...campaign,
      dispatches: campaign.dispatches.map((item) => ({
        ...item,
        manualUrl: !item.destination ? null : campaign.channel === 'whatsapp'
          ? `https://wa.me/${item.destination.replace(/\D/g, '')}?text=${encodeURIComponent(item.renderedMessage)}`
          : `sms:${item.destination}?body=${encodeURIComponent(item.renderedMessage)}`,
      })),
    };
  }

  async markOpened(actor: AuthUser, campaignId: string, dispatchId: string, req: Request) {
    const item = await this.prisma.messageDispatch.findFirst({
      where: { id: dispatchId, campaignId, campaign: { organizationId: actor.organizationId } },
    });
    if (!item) throw new NotFoundException('سجل الإرسال غير موجود');
    const updated = await this.prisma.messageDispatch.update({ where: { id: item.id }, data: { status: 'opened_manual' } });
    await this.audit.log({ userId: actor.id, action: 'message_dispatch_opened_manual', entityTable: 'message_dispatches', entityId: item.id, req });
    return updated;
  }
}
