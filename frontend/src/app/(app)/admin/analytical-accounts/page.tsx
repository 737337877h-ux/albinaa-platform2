"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Upload, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { CCY_AR } from "@/lib/format";
import { PageHeader } from "@/components/app-shell";
import { DataState, PermissionNotice } from "@/components/ui/data-state";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Money,
  Pagination,
  Select,
} from "@/components/ui/primitives";
import { Table, THead, TRow, TD } from "@/components/ui/table";

/**
 * Analytical Accounts (PR-7): extensible non-customer accounting accounts
 * (debtors, employee advances, employee custodies). Fully separate from
 * customer balances — this page never reads/writes CustomerBalance,
 * accountingBalance, or operationalBalance; the "balance" shown here is
 * SUM(debit) - SUM(credit) over AnalyticalMovement for this account only.
 */

const CATEGORY_AR: Record<string, string> = {
  debtor: "مدين",
  employee_advance: "سلفة موظف",
  employee_custody: "عهدة موظف",
  other: "أخرى",
};

interface AnalyticalAccountItem {
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

interface AccountsResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: AnalyticalAccountItem[];
}

interface ImportError {
  rowNumber: number;
  message: string;
}

interface ImportResult {
  importJobId: string;
  accountsCreated: number;
  accountsUpdated: number;
  movementsInserted: number;
  movementsSkippedDuplicate: number;
  errors: ImportError[];
}

export default function AnalyticalAccountsPage() {
  const can = useCan();
  const canRead = can("analytical_accounts.read");
  const canManage = can("analytical_accounts.manage");
  const qc = useQueryClient();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [currency, setCurrency] = useState("");
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const query = useQuery<AccountsResponse>({
    queryKey: ["analytical-accounts", search, category, currency, page],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "25");
      if (search) params.set("search", search);
      if (category) params.set("category", category);
      if (currency) params.set("currencyCode", currency);
      return api<AccountsResponse>(`/analytical-accounts?${params.toString()}`);
    },
    enabled: canRead,
  });

  const [createForm, setCreateForm] = useState({
    accountNumber: "",
    accountName: "",
    category: "debtor",
    personName: "",
    employeeNumber: "",
    currencyCode: "YER",
  });
  const createValid =
    createForm.accountNumber.trim() !== "" &&
    createForm.accountName.trim() !== "";

  const createMut = useMutation({
    mutationFn: () =>
      api("/analytical-accounts", {
        method: "POST",
        body: JSON.stringify({
          accountNumber: createForm.accountNumber,
          accountName: createForm.accountName,
          category: createForm.category,
          personName: createForm.personName || undefined,
          employeeNumber: createForm.employeeNumber || undefined,
          currencyCode: createForm.currencyCode,
        }),
      }),
    onSuccess: () => {
      toast("تم إنشاء الحساب بنجاح", "ok");
      setCreateOpen(false);
      setCreateForm({
        accountNumber: "",
        accountName: "",
        category: "debtor",
        personName: "",
        employeeNumber: "",
        currencyCode: "YER",
      });
      qc.invalidateQueries({ queryKey: ["analytical-accounts"] });
    },
    onError: (err: Error) => toast(err.message, "err"),
  });

  const [importLayout, setImportLayout] = useState<"debtor" | "employee">(
    "debtor",
  );
  const [importFile, setImportFile] = useState<File | null>(null);
  const importMut = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", importFile as File);
      return api<ImportResult>(
        `/analytical-accounts/import?layout=${importLayout}`,
        {
          method: "POST",
          body: fd,
        },
      );
    },
    onSuccess: (data) => {
      const errSuffix = data.errors.length
        ? ` — ${data.errors.length} صف بأخطاء`
        : "";
      toast(
        `تم الاستيراد: ${data.movementsInserted} حركة جديدة، ${data.movementsSkippedDuplicate} مكررة متجاهَلة${errSuffix}`,
        "ok",
      );
      setImportOpen(false);
      setImportFile(null);
      qc.invalidateQueries({ queryKey: ["analytical-accounts"] });
    },
    onError: (err: Error) => toast(err.message, "err"),
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
        title="الحسابات التحليلية"
        action={
          canManage ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" aria-hidden />
                استيراد
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                حساب جديد
              </Button>
            </div>
          ) : undefined
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-concrete-100 px-4 py-3 dark:border-white/10">
          <div className="relative min-w-[200px] flex-1">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-concrete-400"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="بحث برقم الحساب، الاسم، أو الموظف…"
              className="pr-10"
            />
          </div>
          <Select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className="w-48"
          >
            <option value="">كل الأنواع</option>
            {Object.entries(CATEGORY_AR).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
          <Select
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value);
              setPage(1);
            }}
            className="w-40"
          >
            <option value="">كل العملات</option>
            {Object.entries(CCY_AR).map(([code, name]) => (
              <option key={code} value={code}>
                {name} ({code})
              </option>
            ))}
          </Select>
        </div>

        <DataState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
          isFetching={query.isFetching}
          isEmpty={!query.data?.items?.length}
          emptyTitle="لا توجد حسابات تحليلية"
          skeletonClassName="h-64"
        >
          {query.data && (
            <>
              <Table>
                <THead
                  cols={[
                    "رقم الحساب",
                    "الاسم",
                    "النوع",
                    "الشخص/الموظف",
                    "العملة",
                    "الرصيد",
                    "الحالة",
                  ]}
                />
                <tbody>
                  {query.data.items.map((a) => (
                    <TRow
                      key={a.id}
                      onClick={() =>
                        router.push(`/admin/analytical-accounts/${a.id}`)
                      }
                    >
                      <TD>
                        <Link
                          href={`/admin/analytical-accounts/${a.id}`}
                          className="font-medium text-pine-700 hover:underline dark:text-pine-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {a.accountNumber}
                        </Link>
                      </TD>
                      <TD>{a.accountName}</TD>
                      <TD>
                        <Badge tone="pine">
                          {CATEGORY_AR[a.category] ?? a.category}
                        </Badge>
                      </TD>
                      <TD className="text-concrete-600 dark:text-concrete-400">
                        {a.personName ?? "—"}
                        {a.employeeNumber ? ` (${a.employeeNumber})` : ""}
                      </TD>
                      <TD>{a.currencyCode}</TD>
                      <TD>
                        <Money
                          value={a.balance}
                          currency={a.currencyCode}
                          signed
                        />
                      </TD>
                      <TD>
                        <Badge
                          tone={a.status === "active" ? "pine" : "neutral"}
                        >
                          {a.status === "active" ? "نشط" : "غير نشط"}
                        </Badge>
                      </TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
              <Pagination
                page={query.data.page}
                totalPages={query.data.totalPages}
                onPage={setPage}
              />
            </>
          )}
        </DataState>
      </Card>

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="حساب تحليلي جديد"
      >
        <div className="space-y-4">
          <Field label="رقم الحساب *">
            <Input
              value={createForm.accountNumber}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, accountNumber: e.target.value }))
              }
            />
          </Field>
          <Field label="اسم الحساب *">
            <Input
              value={createForm.accountName}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, accountName: e.target.value }))
              }
            />
          </Field>
          <Field label="النوع *">
            <Select
              value={createForm.category}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, category: e.target.value }))
              }
            >
              {Object.entries(CATEGORY_AR).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="اسم الشخص" hint="اختياري">
            <Input
              value={createForm.personName}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, personName: e.target.value }))
              }
            />
          </Field>
          <Field label="رقم الموظف" hint="اختياري — لسلف/عهد الموظفين">
            <Input
              value={createForm.employeeNumber}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, employeeNumber: e.target.value }))
              }
            />
          </Field>
          <Field label="العملة *">
            <Select
              value={createForm.currencyCode}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, currencyCode: e.target.value }))
              }
            >
              {Object.entries(CCY_AR).map(([code, name]) => (
                <option key={code} value={code}>
                  {name} ({code})
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              إلغاء
            </Button>
            <Button
              disabled={!createValid}
              loading={createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              إنشاء
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="استيراد حسابات تحليلية"
      >
        <div className="space-y-4">
          <Field
            label="نوع الملف *"
            hint="ملف CSV بترتيب الأعمدة المتوقع لكل نوع"
          >
            <Select
              value={importLayout}
              onChange={(e) =>
                setImportLayout(e.target.value as "debtor" | "employee")
              }
            >
              <option value="debtor">
                مدينون (رقم الحساب، اسم الحساب، العملة، التاريخ، نوع المستند،
                رقم المستند، الوصف، مدين، دائن)
              </option>
              <option value="employee">
                سلف/عهد موظفين (رقم الموظف، اسم الموظف، رقم/اسم الحساب، العملة،
                التاريخ، نوع المستند، رقم المستند، الوصف، مدين، دائن)
              </option>
            </Select>
          </Field>
          <Field label="الملف *" hint="ملف CSV — UTF-8">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-concrete-600 dark:text-concrete-400"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setImportOpen(false)}>
              إلغاء
            </Button>
            <Button
              disabled={!importFile}
              loading={importMut.isPending}
              onClick={() => importMut.mutate()}
            >
              استيراد
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
