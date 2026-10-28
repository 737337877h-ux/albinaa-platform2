'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BrainCircuit, ShieldCheck, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Card, Pagination } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { inventoryNumber, OracleInventorySummary } from '@/lib/oracle-inventory';

const DECISION_LABELS: Record<string, string> = {
  negative_stock: 'رصيد سالب يحتاج تحقيقًا',
  stockout_risk: 'مخاطر النفاد مع صرف حديث',
  reorder: 'يجب إعادة التوريد',
  dead_stock: 'الأصناف الراكدة',
  slow_moving: 'الأصناف بطيئة الحركة',
  overstock: 'المخزون الزائد',
  seasonal_candidate: 'الأصناف المرشحة للموسمية',
  fast_moving: 'الأصناف سريعة الحركة',
  insufficient_history: 'تاريخ حركة غير كافٍ',
};

export default function InventoryDecisionPage() {
  const can = useCan();
  const allowed = can('inventory.read');
  const params = useParams<{ type: string }>();
  const decisionType = decodeURIComponent(String(params.type || ''));
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [decisionType]);

  const query = useQuery<OracleInventorySummary>({
    queryKey: ['oracle-inventory-decisions', decisionType, page],
    queryFn: () => api(`/oracle-inventory/summary?decisionType=${encodeURIComponent(decisionType)}&decisionPage=${page}&decisionLimit=24`),
    enabled: allowed && !!decisionType,
  });

  if (!allowed) return <Card><PermissionNotice message="لا تملك صلاحية عرض المخزون" /></Card>;

  const classification = query.data?.classificationSummary.find((item) => item.type === decisionType);
  const title = DECISION_LABELS[decisionType] ?? 'قرارات المخزون';

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        action={<Link href="/inventory" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface-2 px-4 text-sm font-bold text-ink-hi hover:border-brand"><ArrowRight className="h-4 w-4" />العودة إلى المخزون</Link>}
      />

      <Card className="border-r-4 border-r-brand p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 font-bold text-ink-hi"><BrainCircuit className="h-5 w-5 text-brand" />{title}</p>
            <p className="mt-1 text-xs text-ink-mid">صفحة مستقلة تعرض الأصناف المصنفة بهذا القرار من مرآة Oracle للقراءة فقط.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="pine" className="gap-1"><ShieldCheck className="h-3.5 w-3.5" />قراءة فقط</Badge>
            <Badge tone="hazard">{inventoryNumber(classification?.count ?? query.data?.decisionPagination.total ?? 0)} صنف</Badge>
          </div>
        </div>
        {classification && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Metric label="عدد الأصناف" value={classification.count} />
            <Metric label="قيمة المخزون" value={classification.stockValue} fraction />
            <Metric label="التوريد المقترح" value={classification.recommendedSupplyQuantity} />
          </div>
        )}
      </Card>

      <DataState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        isFetching={query.isFetching}
        isEmpty={!!query.data && query.data.decisions.length === 0}
        emptyTitle="لا توجد أصناف في هذا التصنيف"
        skeletonClassName="h-72"
      >
        {query.data && (
          <Card className="overflow-hidden">
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {query.data.decisions.map((decision) => (
                <Link key={decision.itemCode} href={`/inventory/items/${encodeURIComponent(decision.itemCode)}`} className="rounded-xl border border-line bg-canvas-soft p-4 transition hover:border-brand hover:shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div><p className="font-semibold text-ink-hi">{decision.itemName}</p><p className="tnum mt-0.5 text-xs text-ink-low" dir="ltr">{decision.itemCode}</p></div>
                    <TriangleAlert className={`h-5 w-5 shrink-0 ${decision.severity === 'critical' ? 'text-debt-700' : decision.severity === 'high' ? 'text-hazard-700' : decision.severity === 'medium' ? 'text-gold' : 'text-info'}`} />
                  </div>
                  <div className="mt-3 flex items-center gap-2"><Badge>{decision.confidence === 'high' ? 'ثقة عالية' : decision.confidence === 'medium' ? 'ثقة متوسطة' : 'تقييم أولي'}</Badge></div>
                  <p className="mt-3 text-xs text-debt-700"><b>المخاطرة:</b> {decision.risk}</p>
                  <p className="mt-2 text-xs text-brand"><b>القرار:</b> {decision.recommendation}</p>
                  {decision.hasStockBalance === false && <p className="mt-2 text-xs text-hazard-700">لا يوجد صف رصيد في اللقطة؛ الكمية المقترحة تقديرية حتى تأكيد الرصيد الحالي.</p>}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-mid">
                    <span>الرصيد: <b className="tnum">{inventoryNumber(decision.currentQuantity)}</b></span>
                    <span>صرف 90 يومًا: <b className="tnum">{inventoryNumber(decision.outbound90)}</b></span>
                    <span>القيمة: <b className="tnum">{inventoryNumber(decision.stockValue, 2)}</b></span>
                    <span>التغطية: <b className="tnum">{decision.daysOfCover == null ? '—' : `${inventoryNumber(decision.daysOfCover, 1)} يوم`}</b></span>
                  </div>
                  {decision.recommendedSupplyQuantity > 0 && <div className="mt-3 rounded-lg bg-brand/10 px-3 py-2 text-sm font-extrabold text-brand">الكمية المقترحة: <span className="tnum">{inventoryNumber(decision.recommendedSupplyQuantity)}</span></div>}
                </Link>
              ))}
            </div>
            <Pagination page={query.data.decisionPagination.page} totalPages={query.data.decisionPagination.totalPages} onPage={setPage} />
          </Card>
        )}
      </DataState>
    </div>
  );
}

function Metric({ label, value, fraction = false }: { label: string; value: number; fraction?: boolean }) {
  return <div className="rounded-xl bg-canvas-soft p-3"><p className="text-xs text-ink-mid">{label}</p><p className="tnum mt-1 text-xl font-extrabold text-ink-hi">{inventoryNumber(value, fraction ? 2 : 0)}</p></div>;
}
