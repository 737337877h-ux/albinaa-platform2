export interface DashboardSummary {
  customers: { total: number; active: number; withBalances: number };
  customerAlerts?: {
    unassigned: { count: number; items: { id: string; name: string; externalCustomerCode: string; createdAt: string }[] };
    newCustomers: { count: number; since: string; items: { id: string; name: string; externalCustomerCode: string; createdAt: string }[] };
  };
  advances: { accounts: number; byCurrency: Record<string, {
    accounts: number; debtorAccounts: number; debtorBalance: number;
    creditorAccounts: number; creditorBalance: number; netBalance: number;
  }>; sourceAccountCodes?: string[] };
  methodology?: { debtScope: string };
  byCurrency: Record<string, { debtors: number; debtTotal: number; creditors: number; creditTotal: number; zero: number }>;
  lastImport: { id: string; fileName: string; importedAt: string } | null;
  newDebt: {
    window?: { from: string; to: string; hours: number };
    source?: string;
    betweenImports?: { latest: string; previous: string | null };
    comparison?: {
      latestFile: string;
      previousFile: string | null;
      comparable: boolean;
    };
    perCurrency?: Record<string, {
      amount: number;
      netChange?: number;
      positiveIncreases?: number;
      decreases?: number;
      accounts: number;
      affectedCount?: number;
      newDebtors: number;
      affectedAccounts?: DebtChangeAccount[];
    }>;
    note?: string | null;
  } | null;
}
export interface CollectorSummary {
  assignedCustomers: number;
  toContactToday: number;
  overdueFollowups: number;
  overduePromises: number;
  collectionsToday: Record<string, { total: number; count: number }>;
  outstandingByCurrency: Record<string, { total: number; debtors: number }>;
}
export interface PromiseItem {
  id: string; expectedAmount: string | number; currencyCode: string; status: string; dueDate: string;
  customer: { id: string; name: string } | null;
}
export interface CollectionsResponse {
  total: number;
  totalsByCurrency: Record<string, number>;
  items: { id: string; amount: string | number; currencyCode: string; collectedAt: string;
    status?: string; source?: 'platform_collection' | 'oracle_receipt_request';
    customer: { id: string | null; name: string } | null; method: { name: string } | null }[];
}
export interface TaskItem {
  customerId: string; customerName: string; reason: string; priority: number;
  expectedAmount?: number; currency?: string;
  balances: { currency: string; balance: number }[];
}
export interface TodayTasks { isCollector: boolean; items: TaskItem[]; summary: { tasksToday: number } }
export interface NotificationItem { id: string; kind: string; readAt: string | null; createdAt: string; payload: Record<string, unknown> }
export interface NotificationsResponse { unread: number; items: NotificationItem[] }
export interface ReservationSummary {
  activeCount: number;
  customerCount: number;
  totalTons: number;
  totalsByCurrency: { currency: string; amount: number }[];
  averageTonPriceByCurrency: { currency: string; averageTonPrice: number; totalTons: number }[];
  unweightedUnits: { unitName: string; qty: number }[];
  expiringIn7Days: number;
}
export interface DebtChangeAccount {
  customerId: string;
  customerName: string;
  customerCode: string;
  currencyCode: string;
  previousBalance: number;
  currentBalance: number;
  change: number;
  direction: 'increase' | 'decrease';
}

export interface KpiResponse {
  customers: { total: number; active: number; debtors: number };
  debtByCurrency: Record<string, number>;
  riskDistribution: Record<string, number>;
  tasksToday: { total: number; assigned: number; unassigned: number };
  topReasons: { taskType: string; count: number }[];
  debt120Plus: { count: number; totalByCurrency: Record<string, number> };
  concentrationByCurrency: Record<string, {
    totalDebt: number; top10Debt: number; percentage: number;
    topCustomers: { customerId: string; customerName: string; customerCode: string | null; amount: number }[];
  }>;
  highRiskCustomers: {
    customerId: string; customerCode: string | null; customerName: string;
    score: number; riskLevel: string;
  }[];
  topPriorityTasks: {
    taskId: string; customerId: string; customerName: string; customerCode: string | null;
    taskType: string; priority: number; priorityReason: string;
    expectedAmount: number | null; expectedCurrency: string | null; assignedTo: string | null;
  }[];
  collectorPerformanceToday: {
    collectorId: string; collectorName: string; currency: string; amount: number; count: number;
  }[];
}
