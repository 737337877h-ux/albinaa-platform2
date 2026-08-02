"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/app-shell";
import { DataState, PermissionNotice } from "@/components/ui/data-state";
import {
  Badge,
  Card,
  CardHeader,
  Money,
  Pagination,
} from "@/components/ui/primitives";
import { Table, THead, TRow, TD } from "@/components/ui/table";

/**
 * Analytical account statement (PR-7): AnalyticalMovement rows for one
 * AnalyticalAccount, with a running balance = SUM(debit) - SUM(credit).
 * Fully separate from Customer/CustomerBalance — no accountingBalance or
 * operationalBalance is read or displayed here.
 */

const CATEGORY_AR: Record<string, string> = {
  debtor: "مدين",
  employee_advance: "سلفة موظف",
  employee_custody: "عهدة موظف",
  other: "أخرى",
};

interface AnalyticalAccountDetail {
  id: string;
  accountNumber: string;
  accountName: string;
  category: string;
  personName: string | null;
  employeeNumber: string | null;
  currencyCode: string;
  status: string;
  balance: number;
}

interface StatementRow {
  date: string;
  documentType: string | null;
  documentNumber: string | null;
  description: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

interface StatementResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: StatementRow[];
}

export default function AnalyticalAccountStatementPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const canRead = can("analytical_accounts.read");
  const [page, setPage] = useState(1);

  const account = useQuery<AnalyticalAccountDetail>({
    queryKey: ["analytical-account", id],
    queryFn: () => api<AnalyticalAccountDetail>(`/analytical-accounts/${id}`),
    enabled: canRead,
  });

  const statement = useQuery<StatementResponse>({
    queryKey: ["analytical-account-statement", id, page],
    queryFn: () =>
      api<StatementResponse>(
        `/analytical-accounts/${id}/statement?page=${page}&limit=50`,
      ),
    enabled: canRead,
  });

  if (!canRead) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية عرض الحسابات التحليلية (analytical_accounts.read)" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="كشف حساب تحليلي"
        action={
          <Link
            href="/admin/analytical-accounts"
            className="flex items-center gap-1 text-sm text-pine-700 hover:underline dark:text-pine-100"
          >
            <ArrowRight className="h-4 w-4" aria-hidden />
            الحسابات التحليلية
          </Link>
        }
      />

      <DataState
        isLoading={account.isLoading}
        isError={account.isError}
        error={account.error}
        onRetry={() => account.refetch()}
        isFetching={account.isFetching}
        isEmpty={false}
        emptyTitle=""
        skeletonClassName="h-28"
      >
        {account.data && (
          <Card className="p-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-concrete-500">رقم الحساب</p>
                <p className="font-medium" dir="ltr">
                  {account.data.accountNumber}
                </p>
              </div>
              <div>
                <p className="text-xs text-concrete-500">الاسم</p>
                <p className="font-medium">{account.data.accountName}</p>
              </div>
              <div>
                <p className="text-xs text-concrete-500">النوع</p>
                <Badge tone="pine">
                  {CATEGORY_AR[account.data.category] ?? account.data.category}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-concrete-500">الرصيد الحالي</p>
                <p className="text-lg font-bold">
                  <Money
                    value={account.data.balance}
                    currency={account.data.currencyCode}
                    signed
                  />
                </p>
              </div>
              {account.data.personName && (
                <div>
                  <p className="text-xs text-concrete-500">الشخص/الموظف</p>
                  <p className="font-medium">
                    {account.data.personName}
                    {account.data.employeeNumber
                      ? ` (${account.data.employeeNumber})`
                      : ""}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-concrete-500">الحالة</p>
                <Badge
                  tone={account.data.status === "active" ? "pine" : "neutral"}
                >
                  {account.data.status === "active" ? "نشط" : "غير نشط"}
                </Badge>
              </div>
            </div>
          </Card>
        )}
      </DataState>

      <Card>
        <CardHeader title="الحركات" />
        <DataState
          isLoading={statement.isLoading}
          isError={statement.isError}
          error={statement.error}
          onRetry={() => statement.refetch()}
          isFetching={statement.isFetching}
          isEmpty={!statement.data?.items?.length}
          emptyTitle="لا توجد حركات على هذا الحساب"
          skeletonClassName="h-64"
        >
          {statement.data && (
            <>
              <Table>
                <THead
                  cols={[
                    "التاريخ",
                    "نوع المستند",
                    "رقم المستند",
                    "الوصف",
                    "مدين",
                    "دائن",
                    "الرصيد الجاري",
                  ]}
                />
                <tbody>
                  {statement.data.items.map((m, i) => (
                    <TRow key={`${m.date}-${i}`}>
                      <TD>{fmtDate(m.date)}</TD>
                      <TD className="text-concrete-600 dark:text-concrete-400">
                        {m.documentType ?? "—"}
                      </TD>
                      <TD className="font-mono text-xs">
                        <span dir="ltr">{m.documentNumber ?? "—"}</span>
                      </TD>
                      <TD className="max-w-[240px] truncate text-xs">
                        {m.description ?? "—"}
                      </TD>
                      <TD>
                        {m.debit > 0 ? (
                          <Money value={m.debit} />
                        ) : (
                          <span className="text-concrete-400">—</span>
                        )}
                      </TD>
                      <TD>
                        {m.credit > 0 ? (
                          <Money value={m.credit} />
                        ) : (
                          <span className="text-concrete-400">—</span>
                        )}
                      </TD>
                      <TD className="font-semibold">
                        <Money value={m.runningBalance} signed />
                      </TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
              <Pagination
                page={statement.data.page}
                totalPages={statement.data.totalPages}
                onPage={setPage}
              />
            </>
          )}
        </DataState>
      </Card>
    </div>
  );
}
