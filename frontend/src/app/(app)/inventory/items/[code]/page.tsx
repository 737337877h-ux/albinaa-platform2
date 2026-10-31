'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, Barcode, Boxes, Layers3, ShieldCheck, Warehouse } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Card, StatCard } from '@/components/ui/primitives';
import { Table, TD, THead, TRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { usePublishedInventoryVersion } from '@/lib/use-published-inventory-version';
import { useCan } from '@/lib/auth';
import { inventoryNumber, OracleItemDetail } from '@/lib/oracle-inventory';

function priceList(rows: Array<{ currencyCode: string; price: string; unitName?: string }>, fallback = 'غير متاح') {
  return rows.length > 0
    ? rows.map((row) => `${inventoryNumber(row.price)} ${row.currencyCode}${row.unitName ? ` / ${row.unitName}` : ''}`).join(' · ')
    : fallback;
}

export default function InventoryItemDetailPage() {
  const can = useCan();
  const allowed = can('inventory.read');
  const catalogVersion = usePublishedInventoryVersion(allowed);
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(String(params.code));
  const detail = useQuery<OracleItemDetail>({
    queryKey: ['oracle-inventory-item', code, catalogVersion],
    queryFn: () => api(`/oracle-inventory/items/${encodeURIComponent(code)}`),
    enabled: allowed && !!code,
  });

  if (!allowed) return <Card><PermissionNotice message="لا تملك صلاحية عرض الأصناف والمخزون." /></Card>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="بيانات الصنف INVI008"
        action={<Badge tone="pine" className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />قراءة فقط</Badge>}
      />
      <Link href="/inventory" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand hover:underline"><ArrowRight className="h-4 w-4" />العودة إلى المخزون</Link>

      <DataState
        isLoading={detail.isLoading}
        isError={detail.isError}
        error={detail.error}
        onRetry={() => detail.refetch()}
        isFetching={detail.isFetching}
        isEmpty={!detail.data}
        emptyTitle="الصنف غير موجود في لقطة INVI008"
        skeletonClassName="h-96"
      >
        {detail.data && (
          <>
            <Card className="border-r-4 border-r-brand p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-2xl font-extrabold">{detail.data.nameAr}</h2>
                    <Badge tone={detail.data.isInactive ? 'debt' : 'credit'}>{detail.data.isInactive ? 'موقوف' : 'نشط'}</Badge>
                    <Badge tone={detail.data.activity.status === 'demanded' ? 'pine' : detail.data.activity.status === 'moving' ? 'credit' : 'debt'}>{detail.data.activity.labelAr}</Badge>
                    {detail.data.isService && <Badge>خدمة</Badge>}
                  </div>
                  <p className="tnum mt-2 text-sm text-ink-mid" dir="ltr">{detail.data.externalItemCode}</p>
                </div>
                <div className="text-left text-xs text-ink-mid">
                  <p>{detail.data.group.nameAr}</p>
                  <p className="tnum" dir="ltr">{detail.data.externalGroupCode}</p>
                </div>
              </div>
              <p className="mt-4 flex items-center gap-2 text-xs text-ink-mid"><ShieldCheck className="h-4 w-4 text-brand" />هذه البيانات معروضة من لقطة INVI008 ومرآة حركات Oracle للقراءة فقط، ولا يمكن تعديلها من هذه الصفحة.</p>
            </Card>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="عدد الوحدات" value={detail.data.units.length} icon={<Layers3 className="h-4 w-4 text-info" />} />
              <StatCard label="الكمية المتوفرة" value={inventoryNumber(detail.data.stockRows.reduce((sum, row) => sum + Number(row.availableQuantity) * Number(row.packageSize), 0))} icon={<Boxes className="h-4 w-4 text-brand" />} />
              <StatCard label="الكمية الواردة" value={inventoryNumber(detail.data.activity.inboundPrimaryQuantity)} icon={<Barcode className="h-4 w-4 text-credit-700" />} />
              <StatCard label="الكمية المنصرفة" value={inventoryNumber(detail.data.activity.outboundPrimaryQuantity)} icon={<Warehouse className="h-4 w-4 text-debt-700" />} />
              <StatCard label="آخر سعر توريد" value={priceList(detail.data.pricing.lastSupplyPrices, '—')} icon={<Barcode className="h-4 w-4 text-gold" />} />
              <StatCard label="متوسط التكلفة" value={detail.data.pricing.weightedAverageCost == null ? '—' : inventoryNumber(detail.data.pricing.weightedAverageCost)} icon={<Warehouse className="h-4 w-4 text-brand" />} />
              <StatCard label="سعر البيع الافتراضي" value={detail.data.pricing.salePrice == null ? 'غير متاح' : `${inventoryNumber(detail.data.pricing.salePrice)}${detail.data.pricing.salePriceUnit ? ` / ${detail.data.pricing.salePriceUnit}` : ''}`} icon={<Barcode className="h-4 w-4 text-gold" />} />
              <StatCard label="آخر سعر بيع" value={priceList(detail.data.pricing.lastSalePrices)} icon={<Barcode className="h-4 w-4 text-gold" />} />
              <StatCard label="متوسط سعر البيع" value={priceList(detail.data.pricing.averageSalePrices)} icon={<Warehouse className="h-4 w-4 text-brand" />} />
            </div>
            <p className="rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-xs text-ink-mid">{detail.data.pricing.noteAr}</p>

            <Card className="overflow-hidden">
              <div className="border-b border-line px-4 py-3"><h3 className="font-display text-sm font-bold">وحدات الصنف والباركود</h3></div>
              <Table>
                <THead cols={['الوحدة', 'حجم العبوة', 'سعر البيع', 'الباركود', 'الاستخدامات', 'الحالة']} />
                <tbody>
                  {detail.data.units.map((unit) => (
                    <TRow key={`${unit.unitName}-${unit.packageSize}`}>
                      <TD className="font-semibold">{unit.unitName}</TD>
                      <TD className="tnum"><span dir="ltr">{inventoryNumber(unit.packageSize)}</span></TD>
                      <TD className="tnum"><span dir="ltr">{unit.salePrice == null ? '—' : inventoryNumber(unit.salePrice)}</span></TD>
                      <TD className="tnum"><span dir="ltr">{unit.barcode ?? '—'}</span></TD>
                      <TD><div className="flex flex-wrap gap-1">{unit.isMainUnit && <Badge tone="pine">أساسية</Badge>}{unit.isSaleUnit && <Badge>بيع</Badge>}{unit.isPurchaseUnit && <Badge>شراء</Badge>}{unit.isStockUnit && <Badge>مخزون</Badge>}{unit.isPriceUnit && <Badge>تسعير</Badge>}</div></TD>
                      <TD><Badge tone={unit.isInactive ? 'debt' : 'credit'}>{unit.isInactive ? 'موقوفة' : 'نشطة'}</Badge>{unit.inactiveReason && <p className="mt-1 text-xs text-ink-mid">{unit.inactiveReason}</p>}</TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-line px-4 py-3"><h3 className="font-display text-sm font-bold">الرصيد حسب المستودع والوحدة</h3></div>
              <DataState
                isLoading={false}
                isError={false}
                isEmpty={detail.data.stockRows.length === 0}
                emptyTitle="لا يوجد رصيد مسجل لهذا الصنف"
              >
                <Table>
                  <THead cols={['المستودع', 'الوحدة', 'حجم العبوة', 'الرصيد المتاح', 'التكلفة الأساسية', 'متوسط التكلفة']} />
                  <tbody>
                    {detail.data.stockRows.map((row) => (
                      <TRow key={`${row.externalWarehouseCode}-${row.unitName}-${row.packageSize}`}>
                        <TD>{row.warehouse.nameAr}<p className="tnum text-xs text-ink-mid" dir="ltr">{row.externalWarehouseCode}</p></TD>
                        <TD>{row.unitName}</TD>
                        <TD className="tnum"><span dir="ltr">{inventoryNumber(row.packageSize)}</span></TD>
                        <TD className="tnum font-extrabold text-brand"><span dir="ltr">{inventoryNumber(row.availableQuantity)}</span></TD>
                        <TD className="tnum"><span dir="ltr">{row.primaryCost == null ? '—' : inventoryNumber(row.primaryCost)}</span></TD>
                        <TD className="tnum"><span dir="ltr">{row.weightedAverageCost == null ? '—' : inventoryNumber(row.weightedAverageCost)}</span></TD>
                      </TRow>
                    ))}
                  </tbody>
                </Table>
              </DataState>
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-line px-4 py-3"><h3 className="font-display text-sm font-bold">أحدث حركات Oracle — قراءة فقط</h3></div>
              <DataState
                isLoading={false}
                isError={false}
                isEmpty={detail.data.movements.length === 0}
                emptyTitle="لا توجد حركات في مرآة Oracle لهذا الصنف"
              >
                <Table>
                  <THead cols={['التاريخ', 'المستند', 'العميل', 'المستودع', 'الوحدة', 'السعر/العملة', 'وارد', 'صادر', 'البيان']} />
                  <tbody>
                    {detail.data.movements.map((movement) => (
                      <TRow key={movement.documentSequence}>
                        <TD className="tnum"><span dir="ltr">{new Date(movement.movementDate).toLocaleDateString('en-GB')}</span></TD>
                        <TD>{movement.documentTypeLabelAr}<p className="tnum text-xs text-ink-mid" dir="ltr">{movement.documentNumber}</p></TD>
                        <TD>{movement.customer ? <Link href={`/customers/${movement.customer.id}`} className="font-semibold text-brand hover:underline">{movement.customer.name}<span className="tnum mr-1 text-xs" dir="ltr">({movement.customer.externalCustomerCode})</span></Link> : <span className="text-xs text-ink-mid">غير مرتبط بعميل{movement.externalCustomerCode ? ` (${movement.externalCustomerCode})` : ''}</span>}</TD>
                        <TD className="tnum"><span dir="ltr">{movement.externalWarehouseCode}</span></TD>
                        <TD>{movement.unitName}</TD>
                        <TD className="tnum"><span dir="ltr">{movement.itemCost == null ? '—' : `${inventoryNumber(movement.itemCost)} ${movement.currencyCode ?? ''}`}</span></TD>
                        <TD className="tnum font-semibold text-credit-700"><span dir="ltr">{movement.inOut === 1 ? inventoryNumber(movement.itemQuantity) : '—'}</span></TD>
                        <TD className="tnum font-semibold text-debt-700"><span dir="ltr">{movement.inOut === -1 ? inventoryNumber(movement.itemQuantity) : '—'}</span></TD>
                        <TD>{movement.description ?? '—'}</TD>
                      </TRow>
                    ))}
                  </tbody>
                </Table>
              </DataState>
            </Card>
          </>
        )}
      </DataState>
    </div>
  );
}
