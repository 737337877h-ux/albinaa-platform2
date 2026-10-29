'use client';
import Link from 'next/link';
import type {UseQueryResult} from '@tanstack/react-query';
import type {KpiResponse} from './types';
import {DataState} from '@/components/ui/data-state';
import {StackedBar} from '@/components/ui/charts';
import {CurrencyCharts} from './currency-charts';
import {Card,CardHeader,Badge,Money} from '@/components/ui/primitives';
import {Table,THead,TRow,TD} from '@/components/ui/table';
import {fmtMoney,TASK_TYPE_AR} from '@/lib/format';
const RISK_LEVEL_AR: Record<string, string> = {
  low: 'منخفضة', medium: 'متوسطة', high: 'مرتفعة', critical: 'حرجة',
};

export function DashboardInsights({kpis}:{kpis:UseQueryResult<KpiResponse,Error>}){return (        <DataState
          isLoading={kpis.isLoading}
          isError={kpis.isError}
          error={kpis.error}
          onRetry={() => kpis.refetch()}
          isFetching={kpis.isFetching}
          isEmpty={false}
          emptyTitle=""
          skeletonClassName="h-64"
        >
          {kpis.data && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="p-4">
                  <p className="text-xs text-concrete-500">توزيع المخاطر</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {['low', 'medium', 'high', 'critical'].map((lv) => (
                      <div key={lv} className="rounded-lg border border-concrete-100 px-2 py-1.5 text-center dark:border-white/10">
                        <p className="tnum text-lg font-bold text-iron-900 dark:text-concrete-100">
                          {kpis.data.riskDistribution[lv] ?? 0}
                        </p>
                        <p className="text-[10px] text-concrete-500">{RISK_LEVEL_AR[lv] ?? lv}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3">
                    <StackedBar
                      items={[
                        { key: 'low', label: RISK_LEVEL_AR.low, value: kpis.data.riskDistribution.low ?? 0, tone: 'pine' },
                        { key: 'medium', label: RISK_LEVEL_AR.medium, value: kpis.data.riskDistribution.medium ?? 0, tone: 'neutral' },
                        { key: 'high', label: RISK_LEVEL_AR.high, value: kpis.data.riskDistribution.high ?? 0, tone: 'hazard' },
                        { key: 'critical', label: RISK_LEVEL_AR.critical, value: kpis.data.riskDistribution.critical ?? 0, tone: 'debt' },
                      ]}
                    />
                  </div>
                </Card>
                <Link href="/tasks">
                  <Card className="p-4 transition-colors hover:bg-pine-50/40 dark:hover:bg-white/5">
                    <p className="text-xs text-concrete-500">مهام اليوم</p>
                    <p className="tnum mt-1 font-display text-2xl font-bold">{kpis.data.tasksToday.total}</p>
                    <p className="mt-1 text-xs text-concrete-500">
                      مسندة: {kpis.data.tasksToday.assigned} • غير مسندة: {kpis.data.tasksToday.unassigned}
                    </p>
                  </Card>
                </Link>
                <Card className="p-4">
                  <p className="text-xs text-concrete-500">عملاء +120 يوم</p>
                  <p className="tnum mt-1 font-display text-2xl font-bold">{kpis.data.debt120Plus.count}</p>
                  {Object.entries(kpis.data.debt120Plus.totalByCurrency).length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {Object.entries(kpis.data.debt120Plus.totalByCurrency).map(([ccy, amt]) => (
                        <p key={ccy} className="tnum text-xs text-debt-600 dark:text-debt-400" dir="ltr">
                          {fmtMoney(amt)} {ccy}
                        </p>
                      ))}
                    </div>
                  )}
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-concrete-500">أعلى أسباب المهام</p>
                  <ul className="mt-2 space-y-1">
                    {kpis.data.topReasons.map((r) => (
                      <li key={r.taskType} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-concrete-600 dark:text-concrete-400">
                          {TASK_TYPE_AR[r.taskType] ?? r.taskType}
                        </span>
                        <span className="tnum font-bold">{r.count}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-concrete-500">تركيز المخاطر — أعلى 10 عملاء</p>
                  <div className="mt-2 space-y-2">
                    {Object.entries(kpis.data.concentrationByCurrency ?? {}).map(([currency, value]) => (
                      <div key={currency}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold">{currency}</span>
                          <span className="tnum text-lg font-extrabold text-hazard-700 dark:text-hazard-400">{value.percentage.toFixed(1)}%</span>
                        </div>
                        <p className="tnum text-[11px] text-concrete-500" dir="ltr">{fmtMoney(value.top10Debt)} / {fmtMoney(value.totalDebt)}</p>
                      </div>
                    ))}
                    {Object.keys(kpis.data.concentrationByCurrency ?? {}).length === 0 && <p className="text-xs text-concrete-500">لا توجد مديونية موجبة.</p>}
                  </div>
                </Card>
              </div>

              <CurrencyCharts data={kpis.data}/>
              <div className="grid gap-5 xl:grid-cols-2">
                <Card>
                  <CardHeader title="أعلى المخاطر" />
                  <Table>
                    <THead cols={['العميل', 'الدرجة', 'المستوى']} />
                    <tbody>
                      {kpis.data.highRiskCustomers.map((c) => (
                        <TRow key={c.customerId}>
                          <TD>
                            <Link className="font-medium text-pine-700 hover:underline dark:text-pine-100"
                                  href={`/customers/${c.customerId}`}>
                              {c.customerName}
                            </Link>
                            {c.customerCode && <p className="text-xs text-concrete-500" dir="ltr">{c.customerCode}</p>}
                          </TD>
                          <TD className="tnum font-bold">{c.score}</TD>
                          <TD>
                            <Badge tone={c.riskLevel === 'critical' ? 'debt' : c.riskLevel === 'high' ? 'hazard' : 'neutral'}>
                              {RISK_LEVEL_AR[c.riskLevel] ?? c.riskLevel}
                            </Badge>
                          </TD>
                        </TRow>
                      ))}
                    </tbody>
                  </Table>
                </Card>

                <Card>
                  <CardHeader title="أولوية المهام" />
                  <Table>
                    <THead cols={['العميل', 'السبب', 'المبلغ المتوقع']} />
                    <tbody>
                      {kpis.data.topPriorityTasks.map((t) => (
                        <TRow key={t.taskId}>
                          <TD>
                            <Link className="font-medium text-pine-700 hover:underline dark:text-pine-100"
                                  href={`/customers/${t.customerId}`}>
                              {t.customerName}
                            </Link>
                            {t.customerCode && <p className="text-xs text-concrete-500" dir="ltr">{t.customerCode}</p>}
                          </TD>
                          <TD className="max-w-[240px] text-xs leading-5 text-concrete-600 dark:text-concrete-400">
                            <span className="line-clamp-3" title={t.priorityReason}>
                              {t.priorityReason}
                            </span>
                          </TD>
                          <TD>
                            {t.expectedAmount != null && t.expectedCurrency ? (
                              <Money value={t.expectedAmount} currency={t.expectedCurrency} />
                            ) : (
                              <span className="text-concrete-400">—</span>
                            )}
                          </TD>
                        </TRow>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              </div>
            </div>
          )}
        </DataState>);}
