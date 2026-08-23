'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Boxes,
  BrainCircuit,
  CircleDollarSign,
  Database,
  Layers3,
  PackageSearch,
  Search,
  ShieldCheck,
  Warehouse,
} from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Button, Card, Input, Pagination, Select, StatCard } from '@/components/ui/primitives';
import { Table, TD, THead, TRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import {
  inventoryNumber,
  OracleInventorySummary,
  OracleItemGroup,
  OracleItemsResponse,
  OracleStockResponse,
  OracleWarehousesResponse,
} from '@/lib/oracle-inventory';

type InventoryView = 'items' | 'warehouses' | 'stock';

const DECISION_LABELS: Record<string, string> = {
  negative_stock: 'رصيد سالب يحتاج تحقيقًا',
  stockout_risk: 'نفاد مع طلب قائم',
  reorder: 'يجب إعادة التوريد',
  dead_stock: 'صنف راكد',
  slow_moving: 'بطيء الحركة',
  overstock: 'مخزون زائد',
  seasonal_candidate: 'مرشح موسمي',
  fast_moving: 'سريع الحركة',
  insufficient_history: 'تاريخ غير كافٍ',
  normal: 'حركة طبيعية',
  no_stock_no_demand: 'بلا رصيد أو طلب',
};

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function InventoryPage() {
  const can = useCan();
  const allowed = can('reports.read');
  const [view, setView] = useState<InventoryView>('items');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 350);
  const [itemStatus, setItemStatus] = useState('active');
  const [groupCode, setGroupCode] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('');
  const [positiveOnly, setPositiveOnly] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [debouncedSearch, itemStatus, groupCode, warehouseCode, positiveOnly, view]);

  const summary = useQuery<OracleInventorySummary>({
    queryKey: ['oracle-inventory-summary'],
    queryFn: () => api('/oracle-inventory/summary'),
    enabled: allowed,
    staleTime: 60_000,
  });
  const groups = useQuery<OracleItemGroup[]>({
    queryKey: ['oracle-inventory-groups'],
    queryFn: () => api('/oracle-inventory/item-groups'),
    enabled: allowed,
    staleTime: 60_000,
  });
  const warehouses = useQuery<OracleWarehousesResponse>({
    queryKey: ['oracle-inventory-warehouses'],
    queryFn: () => api('/oracle-inventory/warehouses?status=all'),
    enabled: allowed,
    staleTime: 60_000,
  });
  const items = useQuery<OracleItemsResponse>({
    queryKey: ['oracle-inventory-items', debouncedSearch, itemStatus, groupCode, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '25', status: itemStatus });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (groupCode) params.set('groupCode', groupCode);
      return api(`/oracle-inventory/items?${params.toString()}`);
    },
    enabled: allowed && view === 'items',
  });
  const stock = useQuery<OracleStockResponse>({
    queryKey: ['oracle-inventory-stock', debouncedSearch, warehouseCode, positiveOnly, page],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: '25',
        positiveOnly: String(positiveOnly),
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (warehouseCode) params.set('warehouseCode', warehouseCode);
      return api(`/oracle-inventory/stock-balances?${params.toString()}`);
    },
    enabled: allowed && view === 'stock',
  });

  if (!allowed) {
    return <Card><PermissionNotice message="لا تملك صلاحية عرض مخزون Oracle (reports.read)" /></Card>;
  }

  const activeQuery = view === 'items' ? items : view === 'warehouses' ? warehouses : stock;
  const publishedAt = summary.data?.snapshot.publishedAt
    ? new Date(summary.data.snapshot.publishedAt).toLocaleString('ar-YE')
    : '—';

  return (
    <div className="space-y-5">
      <PageHeader
        title="المخزون"
        action={<Badge tone="pine" className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />قراءة فقط</Badge>}
      />

      <Card className="border-r-4 border-r-brand p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4 text-brand" />بيانات من لقطة Oracle المنشورة</p>
            <p className="mt-1 text-xs text-ink-mid">العرض من مرآة المنصة فقط، دون اتصال مباشر أو تعديل على Oracle.</p>
          </div>
          <div className="text-left text-xs text-ink-mid" dir="ltr">
            <p>{summary.data?.snapshot.sourceSchema ?? 'IAS20261'}</p>
            <p dir="rtl">تاريخ النشر: {publishedAt}</p>
          </div>
        </div>
      </Card>

      <DataState
        isLoading={summary.isLoading}
        isError={summary.isError}
        error={summary.error}
        onRetry={() => summary.refetch()}
        isFetching={summary.isFetching}
        isEmpty={false}
        skeletonClassName="h-28"
      >
        {summary.data && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="الأصناف" value={summary.data.counts.items} icon={<PackageSearch className="h-4 w-4 text-brand" />} hint={`${inventoryNumber(summary.data.counts.itemGroups)} مجموعات`} />
            <StatCard label="وحدات الأصناف" value={summary.data.counts.itemUnits} icon={<Layers3 className="h-4 w-4 text-info" />} hint="تشمل وحدات البيع والشراء والمخزون" />
            <StatCard label="المستودعات" value={summary.data.counts.warehouses} icon={<Warehouse className="h-4 w-4 text-gold" />} hint={`${summary.data.branchMappings.length} ربط فرع موثق`} />
            <StatCard label="أسطر الرصيد" value={summary.data.counts.stockBalances} icon={<Boxes className="h-4 w-4 text-brand" />} hint="حسب الصنف والوحدة والمستودع" />
            <StatCard label="إجمالي تكلفة المخزون" value={inventoryNumber(summary.data.valuation.totalInventoryCost, 2)} icon={<CircleDollarSign className="h-4 w-4 text-credit-700" />} hint={`${summary.data.valuation.missingCostRows} صفوف بلا تكلفة — العملة الأساسية`} />
          </div>
        )}
      </DataState>

      {summary.data && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold text-ink-hi"><BrainCircuit className="h-5 w-5 text-brand" />محرك قرارات المخزون</h2>
              <p className="mt-1 text-xs text-ink-mid">تصنيف المخاطر والتوريد والركود والبطء والموسمية من مرآة حركة Oracle للقراءة فقط.</p>
            </div>
            <Badge tone="hazard">{summary.data.decisions.length} قرار</Badge>
          </div>
          <div className="border-b border-line bg-canvas-soft px-4 py-3 text-xs text-ink-mid">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <span>الحركات المحللة: <b className="tnum text-ink-hi">{inventoryNumber(summary.data.movementAnalysis.movementCount)}</b></span>
              <span>الفترة: <b className="tnum text-ink-hi">{summary.data.movementAnalysis.fromDate ? new Date(summary.data.movementAnalysis.fromDate).toLocaleDateString('ar-YE') : '—'} – {summary.data.movementAnalysis.toDate ? new Date(summary.data.movementAnalysis.toDate).toLocaleDateString('ar-YE') : '—'}</b></span>
              <span>التغطية التاريخية: <b className="tnum text-ink-hi">{summary.data.movementAnalysis.coverageDays}</b> يومًا</span>
            </div>
            <p className="mt-1 font-medium text-hazard-700">{summary.data.movementAnalysis.note}</p>
          </div>
          <div className="grid gap-2 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            {summary.data.classificationSummary
              .filter((item) => !['normal', 'no_stock_no_demand'].includes(item.type))
              .map((item) => (
                <Link key={item.type} href={`/inventory/decisions/${encodeURIComponent(item.type)}`} className="rounded-xl border border-line bg-surface-2 p-3 text-right transition hover:border-brand hover:shadow-sm">
                  <p className="text-xs text-ink-mid">{DECISION_LABELS[item.type] ?? item.type}</p>
                  <p className="tnum mt-1 text-xl font-extrabold text-ink-hi">{inventoryNumber(item.count)}</p>
                  <p className="tnum mt-1 text-[11px] text-ink-low">قيمة: {inventoryNumber(item.stockValue, 2)}</p>
                  {item.recommendedSupplyQuantity > 0 && <p className="tnum mt-1 text-[11px] font-bold text-brand">توريد مقترح: {inventoryNumber(item.recommendedSupplyQuantity)}</p>}
                  <p className="mt-2 text-[11px] font-bold text-brand">اضغط لعرض الأصناف</p>
                </Link>
              ))}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="أقسام المخزون">
        {([
          ['items', 'الأصناف', PackageSearch],
          ['warehouses', 'المستودعات', Warehouse],
          ['stock', 'الأرصدة', Boxes],
        ] as const).map(([key, label, Icon]) => (
          <Button key={key} variant={view === key ? 'primary' : 'secondary'} role="tab" aria-selected={view === key} onClick={() => setView(key)}>
            <Icon className="h-4 w-4" />{label}
          </Button>
        ))}
      </div>

      {view !== 'warehouses' && (
        <Card className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-64 flex-1">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-low" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pr-9"
                placeholder={view === 'items' ? 'ابحث بكود الصنف أو الاسم أو الباركود' : 'ابحث بكود الصنف أو اسمه'}
              />
            </div>
            {view === 'items' ? (
              <>
                <Select value={groupCode} onChange={(event) => setGroupCode(event.target.value)} className="w-52">
                  <option value="">كل المجموعات</option>
                  {(groups.data ?? []).map((group) => <option key={group.externalGroupCode} value={group.externalGroupCode}>{group.nameAr}</option>)}
                </Select>
                <Select value={itemStatus} onChange={(event) => setItemStatus(event.target.value)} className="w-40">
                  <option value="active">النشطة</option>
                  <option value="inactive">الموقفة</option>
                  <option value="all">الكل</option>
                </Select>
              </>
            ) : (
              <>
                <Select value={warehouseCode} onChange={(event) => setWarehouseCode(event.target.value)} className="w-52">
                  <option value="">كل المستودعات</option>
                  {(warehouses.data?.items ?? []).map((warehouse) => <option key={warehouse.externalWarehouseCode} value={warehouse.externalWarehouseCode}>{warehouse.nameAr}</option>)}
                </Select>
                <label className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm">
                  <input type="checkbox" checked={positiveOnly} onChange={(event) => setPositiveOnly(event.target.checked)} />
                  الرصيد الموجب فقط
                </label>
              </>
            )}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <DataState
          isLoading={activeQuery.isLoading}
          isError={activeQuery.isError}
          error={activeQuery.error}
          onRetry={() => activeQuery.refetch()}
          isFetching={activeQuery.isFetching}
          isEmpty={view === 'items' ? !items.data?.items.length : view === 'warehouses' ? !warehouses.data?.items.length : !stock.data?.items.length}
          emptyTitle="لا توجد بيانات مطابقة"
          emptyHint="غيّر البحث أو عوامل التصفية ثم حاول مرة أخرى."
          skeletonClassName="h-72"
        >
          {view === 'items' && items.data && (
            <>
              <div className="flex items-center justify-between border-b border-line px-4 py-3 text-xs text-ink-mid">
                <span>إجمالي النتائج: <b className="tnum text-ink-hi">{inventoryNumber(items.data.total)}</b></span>
                <span>اضغط على الصنف لعرض وحداته وأرصدته</span>
              </div>
              <Table>
                <THead cols={['الكود', 'اسم الصنف', 'المجموعة', 'الوحدات', 'متوسط التكلفة', 'الحالة']} />
                <tbody>
                  {items.data.items.map((item) => (
                    <TRow key={item.externalItemCode}>
                      <TD><Link href={`/inventory/items/${encodeURIComponent(item.externalItemCode)}`} className="tnum font-bold text-brand hover:underline" dir="ltr">{item.externalItemCode}</Link></TD>
                      <TD><Link href={`/inventory/items/${encodeURIComponent(item.externalItemCode)}`} className="font-semibold hover:text-brand">{item.nameAr}</Link>{item.isService && <Badge className="mr-2">خدمة</Badge>}</TD>
                      <TD><span className="text-sm">{item.group.nameAr}</span><p className="tnum text-xs text-ink-mid" dir="ltr">{item.externalGroupCode}</p></TD>
                      <TD className="tnum">{item._count.units}</TD>
                      <TD className="tnum"><span dir="ltr">{item.referenceWeightedAverageCost == null ? '—' : inventoryNumber(item.referenceWeightedAverageCost)}</span></TD>
                      <TD><Badge tone={item.isInactive ? 'debt' : 'credit'}>{item.isInactive ? 'موقوف' : 'نشط'}</Badge></TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
              <Pagination page={items.data.page} totalPages={items.data.totalPages} onPage={setPage} />
            </>
          )}

          {view === 'warehouses' && warehouses.data && (
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              {warehouses.data.items.map((warehouse) => (
                <article key={warehouse.externalWarehouseCode} className="rounded-xl border border-line bg-surface-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-display font-bold">{warehouse.nameAr}</p>
                      <p className="tnum mt-1 text-xs text-ink-mid" dir="ltr">{warehouse.externalWarehouseCode}</p>
                    </div>
                    <Badge tone={warehouse.isInactive ? 'debt' : 'credit'}>{warehouse.isInactive ? 'موقوف' : 'نشط'}</Badge>
                  </div>
                  <dl className="mt-4 space-y-2 text-xs">
                    <div className="flex justify-between gap-2"><dt className="text-ink-mid">المجموعة</dt><dd>{warehouse.warehouseGroup?.nameAr ?? '—'}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-ink-mid">أسطر الرصيد</dt><dd className="tnum">{inventoryNumber(warehouse._count.stockRows)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-ink-mid">فرع Oracle</dt><dd className="tnum" dir="ltr">{warehouse.externalBranchCode ?? '—'}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-ink-mid">فرع المنصة</dt><dd className="font-semibold text-brand">{warehouse.branchMapping?.platformBranch.name ?? 'غير مربوط'}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          )}

          {view === 'stock' && stock.data && (
            <>
              <div className="flex items-center justify-between border-b border-line px-4 py-3 text-xs text-ink-mid">
                <span>إجمالي النتائج: <b className="tnum text-ink-hi">{inventoryNumber(stock.data.total)}</b></span>
                <span>الكميات حسب الوحدة المسجلة في Oracle</span>
              </div>
              <Table>
                <THead cols={['الصنف', 'المستودع', 'الوحدة', 'حجم العبوة', 'الرصيد المتاح', 'متوسط التكلفة']} />
                <tbody>
                  {stock.data.items.map((row) => (
                    <TRow key={`${row.externalItemCode}-${row.externalWarehouseCode}-${row.unitName}-${row.packageSize}`}>
                      <TD><Link href={`/inventory/items/${encodeURIComponent(row.externalItemCode)}`} className="font-semibold text-brand hover:underline">{row.itemName}</Link><p className="tnum text-xs text-ink-mid" dir="ltr">{row.externalItemCode}</p></TD>
                      <TD>{row.warehouseName}<p className="tnum text-xs text-ink-mid" dir="ltr">{row.externalWarehouseCode}</p></TD>
                      <TD>{row.unitName}</TD>
                      <TD className="tnum"><span dir="ltr">{inventoryNumber(row.packageSize)}</span></TD>
                      <TD className="tnum font-extrabold text-brand"><span dir="ltr">{inventoryNumber(row.availableQuantity)}</span></TD>
                      <TD className="tnum"><span dir="ltr">{row.weightedAverageCost == null ? '—' : inventoryNumber(row.weightedAverageCost)}</span></TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
              <Pagination page={stock.data.page} totalPages={stock.data.totalPages} onPage={setPage} />
            </>
          )}
        </DataState>
      </Card>
    </div>
  );
}
