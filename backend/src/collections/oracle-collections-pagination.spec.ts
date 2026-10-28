import { CollectionsService } from './collections.service';
import { oracleReceiptActivity } from '../common/oracle-receipt-activity';

jest.mock('../common/oracle-receipt-activity', () => ({ oracleReceiptActivity: jest.fn() }));

it('paginates Oracle and platform receipts together without creating financial records', async () => {
  (oracleReceiptActivity as jest.Mock).mockResolvedValue([
    { id: 'oracle-3', collectedAt: '2026-09-03T00:00:00+03:00', currencyCode: 'SAR', amount: 3, collector: { id: 'c' } },
    { id: 'oracle-1', collectedAt: '2026-09-01T00:00:00+03:00', currencyCode: 'SAR', amount: 1, collector: { id: 'c' } },
  ]);
  const prisma: any = {
    collection: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([
        { id: 'platform-4', collectedAt: new Date('2026-09-04'), amount: 4 },
        { id: 'platform-2', collectedAt: new Date('2026-09-02'), amount: 2 },
      ]),
      groupBy: jest.fn().mockResolvedValue([{ currencyCode: 'SAR', _sum: { amount: 6 } }]),
    },
    attachment: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new CollectionsService(prisma, {} as any, {} as any, {} as any);
  const result = await service.findAll({ organizationId: 'org', permissions: ['customers.read_all'] } as any,
    { page: 2, limit: 2 } as any);
  expect(result.items.map((row) => row.id)).toEqual(['platform-2', 'oracle-1']);
  expect(result).toMatchObject({ total: 4, totalPages: 2, totalsByCurrency: { SAR: 10 } });
  expect(prisma.collection.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 4 });
});

it('shows the complete 20–26 October Oracle range under the approved filter, including both boundary days', async () => {
  (oracleReceiptActivity as jest.Mock).mockResolvedValue([
    {id:'day20',collectedAt:'2026-10-20T00:00:00+03:00',currencyCode:'YER',amount:100,collector:{id:'c'}},
    {id:'day26',collectedAt:'2026-10-26T00:00:00+03:00',currencyCode:'YER',amount:200,collector:{id:'c'}},
    {id:'day27',collectedAt:'2026-10-27T00:00:00+03:00',currencyCode:'YER',amount:300,collector:{id:'c'}},
  ]);
  const prisma:any={collection:{count:jest.fn().mockResolvedValue(0),findMany:jest.fn().mockResolvedValue([]),groupBy:jest.fn().mockResolvedValue([])}};
  const service=new CollectionsService(prisma,{} as any,{} as any,{} as any);
  const result=await service.findAll({organizationId:'org',permissions:['customers.read_all']} as any,
    {fromDate:'2026-10-20',toDate:'2026-10-26',status:'approved',page:1,limit:25});
  expect(result.total).toBe(2);expect(result.totalsByCurrency).toEqual({YER:300});
  expect(result.items.map(r=>r.id)).toEqual(['day26','day20']);
  expect(result.items.every(r=>r.status==='approved')).toBe(true);
});
