import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { searchRank } from './search-ranker';

type SearchItem = {
  type: 'customer' | 'receipt' | 'document' | 'reservation';
  id: string;
  title: string;
  subtitle: string;
  href: string;
  matchValue: string;
};

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  private async customerScope(user: AuthUser): Promise<Prisma.CustomerWhereInput> {
    const base: Prisma.CustomerWhereInput = {
      organizationId: user.organizationId,
      status: { notIn: ['merged', 'import_reversed'] },
    };
    if (user.permissions.includes('customers.read_all')) return base;
    const collector = await this.prisma.collector.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!collector) return { ...base, id: 'no-access' };
    return { ...base, assignments: { some: { collectorId: collector.id, effectiveTo: null } } };
  }

  async search(user: AuthUser, rawQuery: string) {
    const query = rawQuery.trim();
    if (query.length < 2) throw new BadRequestException('اكتب حرفين على الأقل للبحث');
    const normalized = query.normalize('NFKC').replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ');
    const scope = await this.customerScope(user);
    const customerFilter: Prisma.CustomerWhereInput = {
      ...scope,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { nameNormalized: { contains: normalized } },
        { tradeName: { contains: query, mode: 'insensitive' } },
        { externalCustomerCode: { contains: query, mode: 'insensitive' } },
        { phonePrimary: { contains: query } }, { phoneSecondary: { contains: query } }, { whatsapp: { contains: query } },
        { aliases: { some: { aliasNormalized: { contains: normalized.toLowerCase().replace(/[\s()+-]/g, '') } } } },
      ],
    };
    const relationFilter: Prisma.CustomerWhereInput = scope;
    // Four small sequential queries keep the command palette responsive without
    // exhausting constrained production connection pools.
    const customers = await this.prisma.customer.findMany({
      where: customerFilter, take: 8,
      select: { id: true, name: true, externalCustomerCode: true, phonePrimary: true },
    });
    const receipts = await this.prisma.collection.findMany({
      where: {
        customer: relationFilter,
        OR: [
          { receiptNumber: { contains: query, mode: 'insensitive' } },
          { referenceNumber: { contains: query, mode: 'insensitive' } },
          { chequeNumber: { contains: query, mode: 'insensitive' } },
        ],
      }, take: 8, orderBy: { collectedAt: 'desc' },
      include: { customer: { select: { name: true } } },
    });
    const documents = await this.prisma.importedTransaction.findMany({
      where: {
        customer: relationFilter, reversedAt: null,
        OR: [
          { documentNumber: { contains: query, mode: 'insensitive' } },
          { referenceNumber: { contains: query, mode: 'insensitive' } },
        ],
      }, take: 8, orderBy: { txDate: 'desc' },
      include: { customer: { select: { name: true } }, documentType: { select: { name: true } } },
    });
    const reservations = user.permissions.includes('reservations.read')
      ? await this.prisma.reservation.findMany({
        where: {
          customer: relationFilter,
          OR: [
            { documentNumber: { contains: query, mode: 'insensitive' } },
            { itemName: { contains: query, mode: 'insensitive' } },
            { warehouse: { contains: query, mode: 'insensitive' } },
            { customer: { ...relationFilter, OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { externalCustomerCode: { contains: query, mode: 'insensitive' } },
            ] } },
          ],
        }, take: 8, orderBy: { createdAt: 'desc' },
        include: { customer: { select: { id: true, name: true } } },
      })
      : [];

    const items: SearchItem[] = [
      ...customers.map((row) => ({
        type: 'customer' as const, id: row.id, title: row.name,
        subtitle: `${row.externalCustomerCode}${row.phonePrimary ? ` • ${row.phonePrimary}` : ''}`,
        href: `/customers/${row.id}`, matchValue: `${row.name} ${row.externalCustomerCode} ${row.phonePrimary ?? ''}`,
      })),
      ...receipts.map((row) => ({
        type: 'receipt' as const, id: row.id, title: `إيصال ${row.receiptNumber ?? row.referenceNumber ?? row.chequeNumber}`,
        subtitle: `${row.customer.name} • ${Number(row.amount).toLocaleString('en-US')} ${row.currencyCode}`,
        href: `/collections?search=${encodeURIComponent(row.receiptNumber ?? row.referenceNumber ?? row.chequeNumber ?? query)}`,
        matchValue: `${row.receiptNumber ?? ''} ${row.referenceNumber ?? ''} ${row.chequeNumber ?? ''}`,
      })),
      ...documents.map((row) => ({
        type: 'document' as const, id: row.id, title: `${row.documentType.name} ${row.documentNumber ?? row.referenceNumber}`,
        subtitle: `${row.customer.name} • ${row.currencyCode} • ${row.txDate.toISOString().slice(0, 10)}`,
        href: `/customers/${row.customerId}?tab=statement&currency=${row.currencyCode}`,
        matchValue: `${row.documentNumber ?? ''} ${row.referenceNumber ?? ''}`,
      })),
      ...reservations.map((row) => ({
        type: 'reservation' as const, id: row.id,
        title: `حجز ${row.documentNumber ?? row.itemName ?? row.id.slice(0, 8)}`,
        subtitle: `${row.customer.name} • ${row.itemName ?? 'بضاعة'} • ${Number(row.totalAmount ?? row.creditAmount).toLocaleString('en-US')} ${row.currencyCode}`,
        href: `/customers/${row.customer.id}?tab=reservations`,
        matchValue: `${row.documentNumber ?? ''} ${row.itemName ?? ''} ${row.customer.name}`,
      })),
    ];
    items.sort((a, b) => searchRank(a.matchValue, query) - searchRank(b.matchValue, query));
    const counts = items.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.type]: (acc[item.type] ?? 0) + 1 }), {});
    return { query, items: items.slice(0, 20).map(({ matchValue: _matchValue, ...item }) => item), counts };
  }
}
