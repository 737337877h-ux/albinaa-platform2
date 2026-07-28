import { Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCurrencyDto } from './dto/update-currency.dto';

@Injectable()
export class CurrenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll() {
    return this.prisma.currency.findMany({ orderBy: { code: 'asc' } });
  }

  async update(code: string, dto: UpdateCurrencyDto, actor: AuthUser, req?: Request) {
    const before = await this.prisma.currency.findUnique({ where: { code } });
    if (!before) throw new NotFoundException('العملة غير موجودة');

    const data: Record<string, unknown> = {};
    if (dto.sourceCode !== undefined) data.sourceCode = dto.sourceCode;
    if (dto.nameAr !== undefined) data.nameAr = dto.nameAr;
    if (dto.decimals !== undefined) data.decimals = dto.decimals;
    if (dto.active !== undefined) data.active = dto.active;

    const currency = await this.prisma.currency.update({ where: { code }, data });
    await this.audit.log({
      userId: actor.id, action: 'currency_updated', entityTable: 'currencies', entityId: code,
      oldValue: { sourceCode: before.sourceCode, nameAr: before.nameAr, decimals: before.decimals, active: before.active },
      newValue: { sourceCode: currency.sourceCode, nameAr: currency.nameAr, decimals: currency.decimals, active: currency.active },
      req,
    });
    return currency;
  }
}
