'use client';
import Link from 'next/link';
import {PackageCheck,AlertTriangle} from 'lucide-react';
import type {UseQueryResult} from '@tanstack/react-query';
import type {ReservationSummary} from './types';
import {DataState} from '@/components/ui/data-state';
import {Card,Badge} from '@/components/ui/primitives';
import {fmtMoney} from '@/lib/format';
export function DashboardReservations({reservationSummary}:{reservationSummary:UseQueryResult<ReservationSummary,Error>}){return (        <DataState
          isLoading={reservationSummary.isLoading}
          isError={reservationSummary.isError}
          error={reservationSummary.error}
          onRetry={() => reservationSummary.refetch()}
          isFetching={reservationSummary.isFetching}
          isEmpty={false}
          emptyTitle=""
          skeletonClassName="h-40"
        >
          {reservationSummary.data && (
            <Link href="/reservations" className="block">
              <Card className="relative overflow-hidden border-t-2 border-t-sky-400 p-5 transition hover:-translate-y-0.5 hover:shadow-card">
                <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-sky-400/10 to-transparent" />
                <div className="relative flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <PackageCheck className="h-5 w-5 text-sky-500" />
                      <h2 className="font-display text-base font-bold">حجوزات البضاعة</h2>
                      <Badge tone="pine">{reservationSummary.data.activeCount} حجز نشط</Badge>
                    </div>
                    <div className="mt-4 flex items-end gap-2">
                      <span className="tnum font-display text-3xl font-extrabold">{fmtMoney(reservationSummary.data.totalTons)}</span>
                      <span className="pb-1 text-xs text-concrete-500">إجمالي الأطنان</span>
                    </div>
                    {reservationSummary.data.unweightedUnits.length > 0 && (
                      <p className="mt-2 text-xs text-concrete-500">
                        {reservationSummary.data.unweightedUnits.map((u) => `+ ${fmtMoney(u.qty)} ${u.unitName}`).join(' • ')}
                      </p>
                    )}
                  </div>
                  <div className="min-w-[190px] space-y-2">
                    {reservationSummary.data.totalsByCurrency.map((total) => (
                      <div key={total.currency} className="flex items-center justify-between gap-4 rounded-lg bg-concrete-50 px-3 py-2 dark:bg-white/5">
                        <div>
                          <span className="tnum font-bold">{fmtMoney(total.amount)}</span>
                          {reservationSummary.data.averageTonPriceByCurrency.find((item) => item.currency === total.currency) && (
                            <p className="mt-0.5 text-[11px] text-concrete-500">
                              متوسط سعر الطن: {fmtMoney(reservationSummary.data.averageTonPriceByCurrency.find((item) => item.currency === total.currency)!.averageTonPrice)}
                            </p>
                          )}
                        </div>
                        <Badge tone="neutral">{total.currency}</Badge>
                      </div>
                    ))}
                    {reservationSummary.data.expiringIn7Days > 0 && (
                      <div className="flex items-center gap-1.5 text-xs font-medium text-hazard-700 dark:text-hazard-400">
                        <AlertTriangle className="h-4 w-4" />
                        {reservationSummary.data.expiringIn7Days} تنتهي خلال 7 أيام
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          )}
        </DataState>);}
