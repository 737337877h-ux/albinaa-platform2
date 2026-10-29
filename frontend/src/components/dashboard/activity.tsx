'use client';
import Link from 'next/link';
import {AlertTriangle} from 'lucide-react';
import type {UseQueryResult} from '@tanstack/react-query';
import type {PromiseItem,CollectionsResponse,TodayTasks,NotificationsResponse} from './types';
import {PromisesTable} from './promises-table';
import {describeNotification} from '@/lib/notification-presentation';
import {notificationHref} from '@/lib/notification-target';
import {fmtDateTime} from '@/lib/format';
import {Card,CardHeader,Badge,Money} from '@/components/ui/primitives';
import {Table,THead,TRow,TD} from '@/components/ui/table';
import {DataState,PermissionNotice} from '@/components/ui/data-state';
interface Props {canPromisesList:boolean;canCollectionsList:boolean;canTasks:boolean;notCollector:boolean;dueTodayPromises:UseQueryResult<{items:PromiseItem[]},Error>;overduePromises:UseQueryResult<{items:PromiseItem[]},Error>;collectionsToday:UseQueryResult<CollectionsResponse,Error>;tasksToday:UseQueryResult<TodayTasks,Error>;notifications:UseQueryResult<NotificationsResponse,Error>;}
export function DashboardActivity({canPromisesList,canCollectionsList,canTasks,dueTodayPromises,overduePromises,collectionsToday,notCollector,tasksToday,notifications}:Props){return (      <div className="grid gap-5 xl:grid-cols-2">
        {/* الوعود المستحقة والمتأخرة */}
        {canPromisesList&&<Card>
          <CardHeader title="الوعود المستحقة والمتأخرة"
                      action={<Link href="/promises" className="text-xs text-pine-700 dark:text-pine-100">الكل</Link>} />
          {!canPromisesList ? (
            <PermissionNotice message="لا تملك صلاحية عرض وعود السداد" />
          ) : (
            <div className="divide-y divide-concrete-100 dark:divide-white/10">
              <div className="px-4 py-3">
                <p className="mb-2 text-xs font-medium text-concrete-500">مستحقة اليوم</p>
                <DataState
                  isLoading={dueTodayPromises.isLoading}
                  isError={dueTodayPromises.isError}
                  error={dueTodayPromises.error}
                  onRetry={() => dueTodayPromises.refetch()}
                  isFetching={dueTodayPromises.isFetching}
                  isEmpty={!dueTodayPromises.data?.items?.length}
                  emptyTitle="لا وعود مستحقة اليوم"
                  skeletonClassName="h-16"
                >
                  <PromisesTable items={dueTodayPromises.data?.items ?? []} tone="hazard" />
                </DataState>
              </div>
              <div className="px-4 py-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-debt-600 dark:text-debt-400">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  متأخرة
                </p>
                <DataState
                  isLoading={overduePromises.isLoading}
                  isError={overduePromises.isError}
                  error={overduePromises.error}
                  onRetry={() => overduePromises.refetch()}
                  isFetching={overduePromises.isFetching}
                  isEmpty={!overduePromises.data?.items?.length}
                  emptyTitle="لا وعود متأخرة"
                  emptyHint="أحسنت — لا وعود متأخرة حاليًا"
                  skeletonClassName="h-16"
                >
                  <PromisesTable items={overduePromises.data?.items ?? []} tone="debt" />
                </DataState>
              </div>
            </div>
          )}
        </Card>}

        {/* التحصيلات اليومية */}
        {canCollectionsList&&<Card>
          <CardHeader title="تحصيلات اليوم"
                      action={<Link href="/collections" className="text-xs text-pine-700 dark:text-pine-100">الكل</Link>} />
          {!canCollectionsList ? (
            <PermissionNotice message="لا تملك صلاحية عرض التحصيلات" />
          ) : (
            <DataState
              isLoading={collectionsToday.isLoading}
              isError={collectionsToday.isError}
              error={collectionsToday.error}
              onRetry={() => collectionsToday.refetch()}
              isFetching={collectionsToday.isFetching}
              isEmpty={!collectionsToday.data?.items?.length}
              emptyTitle="لا تحصيلات اليوم بعد"
              skeletonClassName="h-32"
            >
              <div className="px-4 py-3">
                {collectionsToday.data && Object.keys(collectionsToday.data.totalsByCurrency).length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {Object.entries(collectionsToday.data.totalsByCurrency).map(([ccy, total]) => (
                      <Badge key={ccy} tone="credit">
                        <Money value={total} currency={ccy} />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <Table>
                <THead cols={['العميل', 'المبلغ', 'الطريقة']} />
                <tbody>
                  {(collectionsToday.data?.items ?? []).map((c) => {
                    const customerId = c.customer?.id;
                    const customerName = c.customer?.name ?? '—';
                    const methodName = c.method?.name ?? '—';
                    return (
                      <TRow key={c.id}>
                        <TD>
                          {customerId ? (
                            <Link className="text-pine-700 hover:underline dark:text-pine-100" href={`/customers/${customerId}`}>
                              {customerName}
                            </Link>
                          ) : (
                            <span>{customerName}</span>
                          )}
                        </TD>
                        <TD><Money value={Number(c.amount)} currency={c.currencyCode} /></TD>
                        <TD className="text-concrete-500">{methodName}</TD>
                      </TRow>
                    );
                  })}
                </tbody>
              </Table>
            </DataState>
          )}
        </Card>}

        {/* المهام والمتابعات المتأخرة */}
        {canTasks&&<Card>
          <CardHeader title="مهام اليوم"
                      action={<Link href="/tasks" className="text-xs text-pine-700 dark:text-pine-100">الكل</Link>} />
          {!canTasks ? (
            <PermissionNotice message="لا تملك صلاحية عرض المهام اليومية" />
          ) : notCollector ? (
            <PermissionNotice message="عمل اليوم متاح لحسابات المحصلين — حسابك إداري بلا عملاء مسندين مباشرة" />
          ) : (
            <DataState
              isLoading={tasksToday.isLoading}
              isError={tasksToday.isError}
              error={tasksToday.error}
              onRetry={() => tasksToday.refetch()}
              isFetching={tasksToday.isFetching}
              isEmpty={!tasksToday.data?.items?.length}
              emptyTitle="لا مهام معلّقة اليوم"
              emptyHint="أحسنت — لا شيء يحتاج متابعة الآن"
              skeletonClassName="h-24"
            >
              <ul className="divide-y divide-concrete-100 dark:divide-white/10">
                {(tasksToday.data?.items ?? []).slice(0, 5).map((t, i) => (
                  <li key={`${t.customerId}-${i}`} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link className="font-medium text-pine-700 hover:underline dark:text-pine-100"
                            href={`/customers/${t.customerId}`}>
                        {t.customerName}
                      </Link>
                      {t.priority <= 2 && <Badge tone="hazard">عاجل</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-concrete-500">{t.reason}</p>
                  </li>
                ))}
              </ul>
            </DataState>
          )}
        </Card>}

        {/* أحدث الإشعارات */}
        <Card>
          <CardHeader title="أحدث الإشعارات"
                      action={<Link href="/notifications" className="text-xs text-pine-700 dark:text-pine-100">الكل</Link>} />
          <DataState
            isLoading={notifications.isLoading}
            isError={notifications.isError}
            error={notifications.error}
            onRetry={() => notifications.refetch()}
            isFetching={notifications.isFetching}
            isEmpty={!notifications.data?.items?.length}
            emptyTitle="لا إشعارات"
            skeletonClassName="h-24"
          >
            <ul className="divide-y divide-concrete-100 dark:divide-white/10">
              {(notifications.data?.items ?? []).map((n) => (
                <li key={n.id} className="text-sm">
                  <Link href={notificationHref(n)} className="block px-4 py-3 hover:bg-concrete-50 dark:hover:bg-white/5">
                    <p className={n.readAt ? 'text-concrete-500' : 'font-medium'}>{describeNotification(n).title}</p>
                    <p className="mt-0.5 text-xs text-concrete-400">{fmtDateTime(n.createdAt)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </DataState>
        </Card>
      </div>
);}
