# APMS v2.0 — Gap Analysis Report

**Document:** `docs/APMS_GAP_ANALYSIS_v1.1.0.md`
**Baseline:** v1.1.0 (tag `v1.1.0`) — released
**Target:** APMS v2.0 Master Specification (20 chapters)
**Date:** 2026-07-31
**Scope:** Analysis only — no code changes, no version bump.

> **Source of truth:** this report is aligned against the official **APMS v2.0 Master Specification** at [`docs/APMS_MASTER_SPEC_v2.0.md`](./APMS_MASTER_SPEC_v2.0.md) (ratification draft, awaiting owner sign-off). All chapter requirements and statuses below reference that document (Part A structure, Part B v1.2.0 direction, Part C chapter requirements, Part D owner-review items). No rows are reconstructed from the task brief. Classification per the master spec: `Implemented` · `Partially Implemented` · `Not Implemented` · `Needs Verification` · `Out of Scope for Current Version`.

---

## 1. Executive Summary

AlBinaa Platform v1.1.0 is a released, production-ready MVP covering the **Collections & Collector workflow**: authentication with RBAC, customers with 360° view, multi-currency balances, collections, follow-ups, promises, tasks/assignments, a fixed-format Excel account-statement import pipeline, dashboards, in-app notifications, and an offline-first React Native collector app.

Against the APMS v2.0 Master Specification (20 chapters, spec Part A):

| Status (spec classification) | Count |
|---|---|
| ✅ Implemented | 3 / 20 |
| 🔶 Partially Implemented | 13 / 20 |
| ❌ Not Implemented | 2 / 20 |
| ⚠️ Needs Verification | 1 / 20 |
| ⛔ Out of Scope for Current Version | 0 / 20 (scope exclusions listed in §15) |

The biggest gaps (per master spec Part B): **(1)** import profiles — only 1 of 6 profiles exists, and real file formats (tab-delimited `.xls`, CP1256) are unsupported, **(2)** the risk engine — `customer_scores` exists but nothing writes it (dead read path), **(3)** no real debt-aging source (aging is estimated only), **(4)** no daily work queue generation, **(5)** hard-coded `null` today-KPIs. These define the approved **v1.2.0** scope (Real Data Foundation + Risk Engine + Daily Work Queue).

No critical security regression was found; security is in strong shape (Argon2id, opaque refresh tokens, throttling, helmet, RBAC). Gaps are primarily feature depth and operational automation.

---

## 2. Current Implementation Summary (v1.1.0)

| Layer | Stack | Notes |
|---|---|---|
| **Backend** | NestJS 10, Prisma 6.7, PostgreSQL 16, Argon2id, JWT (opaque refresh tokens, hashed at rest), helmet, @nestjs/throttler, Swagger (disabled in prod) | 18 feature modules; 38 DB tables; global guard order `ThrottlerGuard → JwtAuthGuard → RolesGuard → PermissionsGuard → IdempotencyInterceptor` |
| **Web dashboard** | Next.js 14.2.5 (App Router), React 18.3.1, Tailwind, @tanstack/react-query, lucide-react | Routes: dashboard, tasks, customers, followups, promises, collections, imports, notifications, admin/* (users, roles, collectors, branches, currencies, settings, audit). **No charting library. No /reports route.** |
| **Mobile** | Expo SDK 57 / RN 0.86, React Navigation v7, TanStack Query, expo-sqlite, expo-secure-store | Screens: login, dashboard, tasks, customers, customer-360, new-followup, new-promise, new-collection, followups-list, collections-list, new-task, upload-receipt, notifications, profile. Offline queue + sync-context, GPS tagging, call/SMS/WhatsApp + map |
| **Import** | Python parser (`backend/parser/albinaa_parser.py` + `parser_cli.py` via subprocess), openpyxl | **XLSX/XLSM only.** Single fixed Arabic account-statement format. Idempotent, dry-run + preview |
| **Ops** | Docker Compose (dev + prod), nginx, backup container (daily 02:00 pg_dump, 30-day retention) | Health endpoints: `/health`, `/health/database`, `/health/ready`, `/health/live` |
| **CI** | `.github/workflows/ci.yml` — 3 jobs | Backend (typecheck, lint, build, unit tests), frontend (typecheck, lint, build, vitest), docker build verification. **No e2e in CI, no deploy job** |

Checks at time of writing: backend typecheck ✅, lint ✅, unit tests 6/6 ✅; frontend typecheck ✅; mobile typecheck ✅, lint ✅ (3 pre-existing unused-import warnings).

---

## 3. Implemented (✅ — per spec Part A)

| # | Feature | Evidence |
|---|---|---|
| C1 | **Authentication & sessions** — login/logout/refresh/me, opaque refresh tokens hashed in DB, Argon2id (spec Ch. 3) | `backend/src/auth/*` |
| C2 | **RBAC** — roles, permissions (30+), roles/permissions guards, admin UI for users/roles/collectors/branches (spec Ch. 2) | `backend/src/roles`, `backend/src/permissions`, `frontend/src/app/(app)/admin/*` |
| C3 | **Customer management + 360° view** — profile, balances, statement history, contacts, call/SMS/WhatsApp, map (spec Ch. 4, core) | `backend/src/customers`, `mobile/src/screens/customer-360.tsx` |
| C4 | **Multi-currency balances** — per-currency debtor/creditor/zero buckets, currency settings, dynamic currencies on mobile (spec Ch. 5, core) | `backend/src/balances`, `backend/src/currencies`, `mobile/src/api/endpoints.ts` |
| C5 | **Collections, follow-ups, promises, tasks** — CRUD + assignment, overdue detection, due reminders (spec Ch. 6/7/8, core) | `backend/src/collections`, `followups`, `promises`, `tasks`, `assignments` |
| C6 | **Interactive in-app notifications** — deep links (e.g. customerId payload), unread badge (spec Ch. 12, in-app part) | `backend/src/notifications`, `backend/src/collections/collections.service.ts` (collection_created), `mobile/src/screens/notifications.tsx` |
| C7 | **Offline-first mobile** — SQLite cache, offline queue, sync-context, GPS tagging on collections/tasks (spec Ch. 13) | `mobile/src/db/database.ts`, `mobile/src/store/sync-context.tsx` |
| C8 | **Idempotency layer** — idempotency-key interceptor + DB table (spec Ch. 16) | guard order; e2e tests |
| C9 | **Health & readiness** — /health family endpoints (spec Ch. 18) | `backend/src/health/*` |
| C10 | **Docs & release engineering** — CHANGELOG, PROJECT_STATE, DATABASE_SCHEMA (38 tables), V11 delivery report, release notes, GitHub Release + APK asset | repo root |

---

## 4. Partially Implemented (🔶 — per spec Part A)

| # | Feature | Current state | Gap (spec ref) |
|---|---|---|---|
| P1 | **Dashboard KPIs** (spec Ch. 10) | `dashboard.service.ts:64-67` hard-codes `followupsToday: null`, `promisesDueToday: null`, `collectionsToday: null` | Today-KPIs not computed; no charting on web — **in v1.2.0 scope (B.7)** |
| P2 | **Debt aging** (spec Ch. 5 / B.4) | `estimatedAging()` buckets debtors by **oldest available transaction date**; `estimated=true` always; basis "أقدم حركة متاحة — ليس تاريخ استحقاق الفاتورة" | No real aging source; import provides no due dates — **in v1.2.0 scope** |
| P3 | **Import pipeline** (spec Ch. 9) | Robust fixed-format XLSX/XLSM importer with dry-run, preview, idempotency, balance reconciliation, auto-created doc types (`effect: 'mixed'`) | Only 1 of 6 profiles (`CUSTOMER_STATEMENT_DETAILS`); no tab-delimited/legacy .xls; unknown columns positional — **in v1.2.0 scope (B.1/B.2)** |
| P4 | **Offline sync** (spec Ch. 13) | Single-user offline queue + sync; S1–S15 & G1–G13 test scenarios documented as "Pending" | No conflict resolution; no background GPS task — out of v1.2.0 scope |
| P5 | **Notifications** (spec Ch. 12) | In-app only (deep-linkable) | Push (FCM/APNS) — out of v1.2.0 scope (B.3) |
| P6 | **Risk & scoring** (spec Ch. 14) | `customer_scores` table + read path exist (Customer 360 `latestScore`, task risk filter `high/critical`); **nothing writes it** | Risk features inert until scoring engine exists — **in v1.2.0 scope (B.5)** |
| P7 | **Backup** (spec Ch. 17) | Prod container cron (02:00 pg_dump, custom+compress, gunzip -t check, 30-day retention) | Dev manual only; off-site S3/B2 documented but not implemented; no `docker-compose.test.yml` — out of v1.2.0 scope |

---

## 5. Not Implemented (❌ — per spec Part A)

| # | Feature | Impact / scope |
|---|---|---|
| M1 | **Risk engine** (spec Ch. 14 / B.5) — no code writes `customer_scores`; `tasks.service.ts:208-218` risk prioritization is dead code | **In v1.2.0 scope** |
| M2 | **Import profiles** 1–4 (spec B.1): `CUSTOMER_MASTER`, `CUSTOMER_BALANCE_SUMMARY`, `DEBT_AGING_SUMMARY`, `DEBT_AGING_DETAILS` — none exist; only `CUSTOMER_STATEMENT_DETAILS` (built-in) exists | **In v1.2.0 scope** |
| M3 | **Real file formats** (spec B.2): tab-delimited `.xls` exports + Arabic encoding (CP1256) unsupported; README claims "Excel/CSV" but code supports only `.xlsx/.xlsm` | **In v1.2.0 scope** |
| M4 | **Daily work queue** (spec Ch. 8 / B.6) — no prioritized daily collector list generation with dedup | **In v1.2.0 scope** |
| M5 | **Reports & analytics module** (spec Ch. 11) — no `/reports` endpoint or page; `reports.export` seed permission "(Future)" | Out of v1.2.0 scope (B.3) |
| M6 | **Application scheduler** (no @nestjs/schedule; idempotency-key TTL cleanup cron missing) | Out of v1.2.0 scope (follows risk engine) |
| M8 | **External observability** (no Prometheus/Grafana/Sentry/APM) | Operational blind spots |

---

## 6. Database Gap Analysis

**Current:** 38 tables (Prisma, PostgreSQL 16). Domain tables present: organizations, branches, users, roles, permissions, customers, balances, collections, followups, promises, tasks, notifications, currencies, import jobs, idempotency keys, audit logs, customer_scores.

| Gap | Evidence | Priority | v1.2.0 |
|---|---|---|---|
| `customer_scores` is never written | schema.prisma:696-708 model exists; grep for `customerScore.create`/`scores.create`/`customer_scores` in `backend/src` → no files | High | **In scope** (risk engine) |
| No reports/export artifacts table (no cached report results, no report templates) | no reports module | Critical | Out of scope |
| Idempotency keys accumulate (no TTL cleanup) | MOBILE_DELIVERY_REPORT:374 — "Add periodic cleanup cron" | Medium | Out of scope |
| No push-notification device tokens table | no FCM/APNS | High (for push feature) | Out of scope |
| Import profiles not represented in schema (no profile entity/config) | no profile concept anywhere | High | **In scope** (PR 2/3) |
| No scheduled-job registry table | no scheduler | Medium | Out of scope |

---

## 7. API Gap Analysis

**Current endpoints:** `/auth/*`, `/users`, `/roles`, `/permissions`, `/customers`, `/balances`, `/collections`, `/followups`, `/promises`, `/tasks`, `/notifications`, `/imports/*` (upload/dry-run/execute/report), `/dashboard/summary`, `/dashboard/collector`, `/health/*`, mobile sync endpoints.

| Gap | Evidence | Priority | v1.2.0 |
|---|---|---|---|
| No `/reports/*` (list, generate, export) | app.module.ts:32-56 — 18 modules, none named reports; `reports.export` = "(Future)" | Critical | Out of scope |
| Dashboard placeholders return `null` | dashboard.service.ts:64-67 | High | **In scope** (B.7) |
| No import profile endpoints (detect/serve profile list, tab-delimited upload) | imports module serves single format only | High | **In scope** (PR 2) |
| No risk endpoint exposing persisted scores | `customer_scores` has no API reader beyond embedded queries | High | **In scope** (PR 4/6) |
| No pagination on some list endpoints (Not verified for all) | Needs Verification | Medium | Out of scope |
| No webhook/integration API surface | none | Medium (later) | Out of scope |
| Swagger disabled in production | MILESTONE7_DELIVERY_REPORT | Low | Out of scope |

---

## 8. Mobile Gap Analysis

**Current:** Expo SDK 57 / RN 0.86; login + server-settings (ping/health/version detection); 15 screens; TanStack Query; expo-sqlite offline cache; offline queue + sync-context; GPS tagging; deep-linkable notifications; call/SMS/WhatsApp + map in customer-360.

| Gap | Evidence | Priority | v1.2.0 |
|---|---|---|---|
| **No push notifications** (FCM/APNS) | MOBILE_DELIVERY_REPORT:366-376 known issues | Critical | Out of scope |
| **Customer360 score panel inert** (shows `latestScore` but nothing computes it) | customers.service.ts:209/258; needs risk engine | High | **In scope** (PR 6) |
| **Daily work queue not surfaced in app** | no prioritized collector list on mobile | High | **In scope** (PR 5/6) |
| Certificate pinning not implemented | MOBILE_DELIVERY_REPORT known issues | Medium | Out of scope |
| No mobile E2E (Detox/Maestro) | MOBILE_DELIVERY_REPORT; offline scenarios S1–S15, G1–G13 "Pending" | Medium | Out of scope |
| GPS background task not registered | MOBILE_DELIVERY_REPORT | Medium | Out of scope |
| No OTA updates | MOBILE_DELIVERY_REPORT | Low | Out of scope |
| No photo/attachment upload on collection (receipt upload screen exists — verify coverage) | upload-receipt.tsx | Medium | Out of scope |

---

## 9. Web Dashboard Gap Analysis

**Current:** Next.js 14.2.5; routes for all domain modules + admin; react-query with 401-retry refresh client (`frontend/src/lib/api.ts`); import page with dry-run + job report modal; **no charting library**.

| Gap | Evidence | Priority | v1.2.0 |
|---|---|---|---|
| **No /reports route** | full route inventory of `frontend/src/app` — no reports/admin-reports/export | Critical | Out of scope |
| No charts/graphs anywhere | frontend package.json — no recharts/chart.js/visx | High | Out of scope |
| Dashboard today-KPIs blank | dashboard.service.ts placeholders | High | **In scope** (B.7) |
| Import page single-format only (no profile picker, no tab-delimited upload) | imports/page.tsx gates `.xlsx/.xlsm` only | High | **In scope** (PR 2) |
| No risk display in customer/tasks pages (filter options absent) | web reads no `latestScore` | High | **In scope** (PR 6) |
| No data export (Excel/CSV) on web | no export lib (xlsx/exceljs absent) | High | Out of scope |

---

## 10. Excel Import Profile Analysis

**Current:** single fixed-format importer — Arabic "كشف الحساب التحليلي" (analytical account statement) with block anchors (رقم العميل، العملة، التاريخ، الرصيد الإفتتاحي، إجمالي العمليات، إجمالي الرصيد لكم/عليكم، الرصيد الحالي). openpyxl `read_only=True, data_only=True`. Transaction rows positional `rr[0..6]`. Extension gate `.xlsx/.xlsm` at both API and UI. Balance reconciliation at execute time. Currency map `YR→YER, SR→SAR, $→USD`. Unknown doc types auto-created as `effect:'mixed'` with review note.

**Required by master spec (Part B.1/B.2):** profiles 1–5 in scope; `ITEM_ANALYSIS_FUTURE` future; real XLSX + tab-delimited `.xls` with CP1256. Status classification per spec.

| Profile (APMS v2.0, spec B.1) | Status | Gap |
|---|---|---|
| CUSTOMER_MASTER | ❌ | No customer-master bulk import profile — in v1.2.0 |
| CUSTOMER_BALANCE_SUMMARY | 🔶 | Balance computed per-account from statement, not imported as a summary profile — in v1.2.0 |
| DEBT_AGING_SUMMARY | ❌ | No aging profile; aging is estimated only — in v1.2.0 (becomes aging source) |
| DEBT_AGING_DETAILS | ❌ | Not supported — in v1.2.0 (becomes aging source) |
| CUSTOMER_STATEMENT_DETAILS | ✅ | This is the built-in format (single profile) |
| ITEM_ANALYSIS_FUTURE | ⛔ | Out of scope for current version (future scope) |

| Format capability (spec B.2) | Status | Evidence |
|---|---|---|
| .xlsx / .xlsm | ✅ | imports.service.ts:42-45 gate; page.tsx:111/131/476 `accept=".xlsx,.xlsm"` |
| Tab-delimited `.xls` exports (Arabic, CP1256) | ❌ | No encoding/delimiter detection; no matches for cp1256/delimiter/tab in backend — in v1.2.0 |
| .xls (legacy OLE2 binary) | ⛔ | Rejected; openpyxl cannot open (spec requires tab-delimited text, not OLE2) |
| CSV | ⛔ | Not required by spec; README's "Excel/CSV" claim is inaccurate |
| Unknown-column handling | 🔶 | Positional reads; stray rows logged to errors and skipped, import continues |

---

## 11. Security & Deployment Gaps

**Strong:** Argon2id, opaque hashed refresh tokens, helmet, throttler, RBAC guards, health endpoints without secrets, idempotency interceptor, prod Swagger disabled.

| Gap | Evidence | Priority |
|---|---|---|
| No virus scanning on uploads | MILESTONE7_DELIVERY_REPORT:436-449 (Medium) | Medium |
| No certificate pinning on mobile | MOBILE_DELIVERY_REPORT | Medium |
| Rate limits not tuned per role | default throttler only | Low |
| No APM / Sentry / New Relic | RELEASE_CHECKLIST:129-131 recommendations only | Medium |
| Single-workflow CI: no e2e, no deploy, no Python parser coverage | ci.yml (3 jobs); e2e 115 local only | Medium |
| `docs/` referenced by README/INSTALL/DEPLOYMENT but did not exist | README.md:43, INSTALL.md:149, DEPLOYMENT.md:198 (created by this report) | Low |

---

## 12. Offline & Sync Gaps

| Gap | Evidence | Priority |
|---|---|---|
| No conflict resolution (multi-device same-customer edits) | MILESTONE7_DELIVERY_REPORT:436-449 (Medium) | Medium |
| No background GPS task registration | MOBILE_DELIVERY_REPORT | Medium |
| Offline test scenarios S1–S15 / G1–G13 not executed | MOBILE_DELIVERY_REPORT:310-346 "Pending" | Medium |
| No explicit offline-first strategy for web | web is online-only | Low |
| Idempotency-key TTL not enforced | MOBILE_DELIVERY_REPORT:374 | Medium |

---

## 13. Reports & Risk Analysis Gaps

| Gap | Evidence | Priority | v1.2.0 |
|---|---|---|---|
| **No reports module/endpoint/page** | no `/reports` anywhere (backend or frontend) | Critical | Out of scope (spec B.3) |
| **No aging recalculation job** | no scheduler; aging computed on-the-fly and estimated | High | Aging source in scope (B.4); recalc job out of scope |
| **No risk scoring engine** | `customer_scores` never written; `latestScore` + risk filter dead | High | **In scope** (B.5) |
| No financial exports (PDF/Excel) | no export libs | High | Out of scope |
| No reconciliation workflow (auto-review of balance mismatches) | `reconciliation.review` = "(Future)" | Medium | Out of scope |
| Dashboard today-KPIs null | dashboard.service.ts:64-67 | High | **In scope** (B.7) |

---

## 14. APMS v2.0 — 20-Chapter Comparison Matrix

> Legend (per [`APMS_MASTER_SPEC_v2.0.md`](./APMS_MASTER_SPEC_v2.0.md) Part A): ✅ Implemented · 🔶 Partially Implemented · ❌ Not Implemented · ⚠️ Needs Verification · ⛔ Out of Scope for Current Version. Requirement column cites the master spec; owner-review items reference spec Part D.

| # | Chapter (spec) | Feature | Status | Current v1.1.0 Implementation | APMS v2.0 Requirement (spec ref) | Gap Details | Priority | Suggested Release |
|---|---|---|---|---|---|---|---|---|
| 1 | Organization & Branch Management | Multi-tenant org + branches | 🔶 | `organizations`, `branches` tables; branch CRUD in admin; assignments by collector/branch | Spec Ch. 1 — org→branch→user hierarchy, per-level settings | Org-level settings (Part D R6); branch-level analytics | Medium | v1.5.0 |
| 2 | Users, Roles & Permissions | RBAC | ✅ | Users/roles/permissions modules; PermissionsGuard; admin UI for all three | Spec Ch. 2 — granular RBAC | Permission-picker coverage check (Part D R7) | Low | v1.2.0 (verify only) |
| 3 | Authentication & Sessions | Login/refresh/logout, token security | ✅ | Opaque hashed refresh tokens, Argon2id, throttler, helmet, /auth/me | Spec Ch. 3 — secure auth | MFA/SSO future (Part D R8) | Medium | v1.5.0 |
| 4 | Customers & 360° View | Customer profile, balances, history | 🔶 | customers module; customer-360 (profile, statement, contacts, call/SMS/WhatsApp, map) | Spec Ch. 4 — 360 incl. score + real aging | Score & aging panels inert (need risk engine + aging import) | High | v1.2.0–v1.3.0 |
| 5 | Multi-Currency Balances | Per-currency debtor/creditor/zero | 🔶 | balances per currency; dynamic currency list on mobile; YR/SR/$ map | Spec Ch. 5 — aging summary per currency feeds risk | No real aging per currency (B.4); FX rates out of scope | High | v1.2.0 |
| 6 | Collections Management | Collect, tag, receipt | ✅ | collections CRUD, GPS tagging, upload-receipt screen, collection_created notification | Spec Ch. 6 — lifecycle + receipts + reconciliation | Reconciliation workflow out of v1.2.0; receipts attach verification pending | Medium | v1.3.0 |
| 7 | Follow-ups & Promises | Follow-up records, promises, due tracking | 🔶 | followups + promises modules; overdue flags; today lists (mobile) | Spec Ch. 7 — feed Daily Work Queue (due + overdue) | Web today-KPIs null; queue integration in v1.2.0 | High | v1.2.0 |
| 8 | Tasks & Collector Assignments | Task scheduling & assignment | 🔶 | tasks + assignments; risk filter in tasks.service (inert) | Spec Ch. 8 / B.6 — Daily Work Queue with dedup | No queue generation; risk filter dead without scoring | High | v1.2.0 |
| 9 | Excel Import Pipeline | Multi-profile import | 🔶 | Single account-statement profile (.xlsx/.xlsm), dry-run, idempotent, reconciliation | Spec Ch. 9 / B.1/B.2 — 5 profiles in scope, tab-delimited `.xls` + CP1256 | Only 1 of 5 in-scope profiles; no tab/.xls/CP1256 (Part D R1) | **Critical** | v1.2.0 |
| 10 | Dashboard & KPIs | Operational dashboard | 🔶 | summary() + collectorDashboard(); aging estimated; 3 today-KPIs null; no charts | Spec Ch. 10 / B.7 — real today-KPIs, documented empty-state, no mock | Charts out of scope; KPIs in scope | High | v1.2.0 |
| 11 | Reports & Analytics | Financial/operational reports | ❌ | None (no endpoint, page, or export) | Spec Ch. 11 — full reports incl. exports | **Entirely missing** — out of v1.2.0 scope (B.3) | Critical (later) | v1.3.0–v1.5.0 |
| 12 | Notifications & Alerts | Notify on events | 🔶 | In-app notifications with deep links, unread badge | Spec Ch. 12 — in-app; push out of v1.2.0 | Push (FCM/APNS) out of v1.2.0 (B.3) | Medium | v1.5.0 |
| 13 | Offline Mobile & Sync | Offline-first collector | 🔶 | SQLite cache, offline queue, sync-context, GPS tagging | Spec Ch. 13 — offline-first | Conflict resolution, background GPS out of v1.2.0 | Medium | v1.3.0 |
| 14 | Risk Scoring & Credit Assessment | Customer scores | ❌ | `customer_scores` table + read path only; nothing writes | Spec Ch. 14 / B.5 — persist score, level, reasons; connect to 360/tasks/filters | **Entirely missing** (dead read path); formula needs review (Part D R3) | **Critical** | v1.2.0 |
| 15 | Audit Trail & Compliance | Audit logs | 🔶 | audit module + admin/audit page | Spec Ch. 15 — compliance audit | Retention policy (Part D R9) | Medium | v1.5.0 |
| 16 | API Security & Rate Limiting | Throttling, security headers | ✅ | ThrottlerGuard global, helmet, idempotency, opaque tokens | Spec Ch. 16 — API security posture | Upload virus scan (Part D R10) | Medium | v1.5.0 |
| 17 | Backup, Recovery & Restore | Backup automation | 🔶 | Prod cron pg_dump (02:00, 30-day), restore script, BACKUP/RESTORE docs | Spec Ch. 17 — automated backup + tested restore | Dev manual; no off-site; no restore-test compose — out of v1.2.0 | Medium | v1.5.0 |
| 18 | Monitoring & Observability | Health + metrics | 🔶 | /health family, docker healthchecks, log rotation | Spec Ch. 18 — health; metrics/APM out of v1.2.0 | No Prometheus/Sentry/alerting | Medium | v1.5.0 |
| 19 | Deployment & CI/CD | Build/test/deploy automation | 🔶 | Single ci.yml (typecheck/lint/build/unit tests + docker build); Docker Compose prod | Spec Ch. 19 — CI/CD | No e2e in CI, no deploy job — out of v1.2.0 | Medium | v1.5.0 |
| 20 | Performance & Scalability | Horizontal scaling readiness | ⚠️ | Stateless backend (Compose scale notes in DEPLOYMENT), prisma, indices on key tables | Spec Ch. 20 — verified scaling + load tests | No load tests; targets needed (Part D R11) | Medium | v1.5.0 |

---

## 15. Priority Ranking

### Critical — v1.2.0 (approved scope: Real Data Foundation + Risk Engine + Daily Work Queue)

1. **Excel import profiles** (spec B.1, Ch. 9) — implement `CUSTOMER_MASTER`, `CUSTOMER_BALANCE_SUMMARY`, `DEBT_AGING_SUMMARY`, `DEBT_AGING_DETAILS`; keep `CUSTOMER_STATEMENT_DETAILS`; `ITEM_ANALYSIS_FUTURE` stays future.
2. **Real file formats** (spec B.2, Ch. 9) — tab-delimited `.xls` exports with Arabic encoding (CP1256) + detection; real XLSX already works.
3. **Debt aging source** (spec B.4, Ch. 5) — imported aging summary/details become the aging + risk source; estimated aging only as labeled fallback.
4. **Risk engine** (spec B.5, Ch. 14) — persist `customer_scores` (score, level, reasons); connect to Customer360, tasks, filters.
5. **Daily work queue** (spec B.6, Ch. 8) — prioritized daily collector list (due promises, overdue promises, aging risk, high balances, no follow-up, needs visit, escalation) with (customer, reason) dedup.
6. **Dashboard today-KPIs** (spec B.7, Ch. 10) — real `followupsToday`/`promisesDueToday`/`collectionsToday`; documented empty-state; no mock data.

### Out of Scope for v1.2.0 (spec B.3)
- Push notifications (FCM/APNS) · Full Reports module + PDF/Excel exports · Major UI/UX redesign · WhatsApp API automation · Production deployment changes · Microservices / GraphQL / multi-tenant · Product/item analytics · Advances/loans file (not part of customer debt collection) · `ITEM_ANALYSIS_FUTURE`.

### Later releases (v1.3.0–v1.5.0)
- Reports & analytics module (Ch. 11), push notifications (Ch. 12), offline conflict resolution (Ch. 13), MFA/SSO (Ch. 3), FX rates (Ch. 5), audit retention (Ch. 15), observability (Ch. 18), CI/CD expansion (Ch. 19), load tests (Ch. 20).

---

## 16. Recommended Release Plan

| Release | Scope | Exit criteria |
|---|---|---|
| **v1.2.0** | **Real Data Foundation + Risk Engine + Daily Work Queue** — import profiles 1–5 + tab-delimited `.xls`/CP1256; debt aging storage/mapping; risk score service (writes `customer_scores`); daily work queue with dedup; Customer360 + tasks integration; dashboard today-KPI fixes | All v1.2.0 scope items in §15 land via the 8-PR plan below; `customer_scores` written by real computation; no hard-coded `null` KPIs; no mock data |
| **v1.3.0** | Reports module (Ch. 11) + push notifications (Ch. 12) + offline sync hardening (Ch. 13) | `/reports` endpoints + page + exports; FCM/APNS; conflict resolution |
| **v1.5.0** | MFA/SSO, FX rates, org settings, audit retention, observability, backup off-site + restore tests, load tests | Platform hardening complete |
| **v2.0.0** | Full APMS v2.0 Master Specification compliance (all 20 chapters) | Gap matrix 20/20 per spec Part A; master-spec owner sign-off |

### Proposed v1.2.0 PR plan (execution order)

| PR | Scope | Key files (anticipated) |
|---|---|---|
| 1 | **APMS docs alignment** (this PR) | `docs/APMS_MASTER_SPEC_v2.0.md`, `docs/APMS_GAP_ANALYSIS_v1.1.0.md` |
| 2 | **Import profile detection/parsers** — profile detection, tab-delimited `.xls` + CP1256, profiles 1–5 | `backend/parser/`, `backend/src/imports/`, `frontend/src/app/(app)/imports/` |
| 3 | **Debt aging import storage/mapping** — persist aging summary/details; aging as source for reports + risk | `prisma/schema.prisma`, `backend/src/imports/`, `backend/src/dashboard/` |
| 4 | **Risk score calculation service** — compute + persist score/level/reasons | `backend/src/risk/` (new), `customer_scores` writer |
| 5 | **Daily work queue generation** — prioritized list with dedup | `backend/src/tasks/`, `backend/src/queues/` (new) |
| 6 | **Customer360 + tasks integration** — live `latestScore`, risk filters, queue on mobile/web | `backend/src/customers/`, `backend/src/tasks/`, `mobile/src/screens/`, `frontend/src/app/` |
| 7 | **Dashboard KPI fixes** — real today-KPIs + documented empty-state | `backend/src/dashboard/`, `frontend/src/app/(app)/dashboard/` |
| 8 | **Tests and final delivery report** — unit/e2e for new modules + report | `backend/test/`, delivery report doc |

---

## Appendix — Evidence & Caveats

- **APMS v2.0 Master Specification** now lives at [`docs/APMS_MASTER_SPEC_v2.0.md`](./APMS_MASTER_SPEC_v2.0.md) (ratification draft). This report cites it as source of truth; owner-review items R1–R11 are in spec Part D.
- Checks run (docs-only change): `backend` typecheck ✅ / lint ✅ / unit 6/6 ✅; `frontend` typecheck ✅; `mobile` typecheck ✅ / lint ✅ (3 pre-existing warnings).
- Known inconsistencies surfaced: `README.md` claims CSV support (code: none); `docs/` referenced but absent (now created); `docker-compose.test.yml` referenced by BACKUP.md but absent; `nnginx/` is a stray empty dir.
- Parser deployment: Python (`py3-openpyxl`) installed in backend Dockerfile; `PYTHON_BIN → python3 → python → py` resolution.
