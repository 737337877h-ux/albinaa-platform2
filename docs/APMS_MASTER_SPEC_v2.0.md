# APMS v2.0 — Master Specification (Ratification Draft)

| Field | Value |
|---|---|
| **Document** | `docs/APMS_MASTER_SPEC_v2.0.md` |
| **Status** | **Ratification Draft — for owner review** |
| **Version** | v2.0 (spec), aligned to platform v1.1.0 baseline |
| **Date** | 2026-07-31 |
| **Classification system** | `Implemented` · `Partially Implemented` · `Not Implemented` · `Needs Verification` · `Out of Scope for Current Version` |
| **Authority** | This document is the source of truth for APMS gap analysis and roadmap. It is a ratification draft: every `Needs Owner Review` item must be confirmed by the owner before it becomes normative. |

> **Purpose.** This document defines the APMS (Accounts Portfolio Management System) v2.0 master specification against which the AlBinaa Platform is measured. It captures the 20-chapter structure, the approved v1.2.0 direction (**Real Data Foundation + Risk Engine + Daily Work Queue**), the 6 Excel import profiles, real file-format requirements, and explicit exclusions.
>
> **Documentation only.** This is a documentation artifact. It authorizes no application-code, database-schema, dependency, or version changes by itself. Development begins only after owner ratification and per-PR approval.

---

## Part A — The 20-Chapter Structure

| # | Chapter | Chapter intent | Current v1.1.0 status | v1.2.0 direction |
|---|---|---|---|---|
| 1 | Organization & Branch Management | Org→branch→user hierarchy, per-level settings | Partially Implemented | No change (out of scope) |
| 2 | Users, Roles & Permissions (RBAC) | Granular role/permission model, guards | Implemented | No change |
| 3 | Authentication & Sessions | Login/refresh/logout, secure token handling | Implemented | No change |
| 4 | Customers & 360° View | Full customer profile: balances, history, contacts, score, aging | Partially Implemented | Integrate real risk score + real aging into Customer360 |
| 5 | Multi-Currency Balances | Per-currency debtor/creditor/zero positions | Partially Implemented | Aging summary per currency feeding risk inputs |
| 6 | Collections Management | Collection records, GPS, receipts, reconciliation | Partially Implemented | No change beyond aging/risk inputs |
| 7 | Follow-ups & Promises | Follow-up log, promises, due/overdue tracking | Partially Implemented | Feed Daily Work Queue (due + overdue promises) |
| 8 | Tasks & Collector Assignments | Task generation, assignment, prioritization | Partially Implemented | **Daily Work Queue** (Part B.6) — real prioritized daily collector list |
| 9 | Excel Import Pipeline | Multi-profile import with detection, dry-run, idempotency | Partially Implemented | **Import Profiles** (Part B.1) + **Real file formats** (Part B.2) |
| 10 | Dashboard & KPIs | Operational KPIs incl. today figures | Partially Implemented | **Replace hard-coded `null` today-KPIs** with real values or documented empty-state logic |
| 11 | Reports & Analytics | Financial/operational reporting + exports | Not Implemented | Out of scope for v1.2.0 |
| 12 | Notifications & Alerts | In-app + push + alert rules | Partially Implemented | Push out of scope for v1.2.0; in-app unchanged |
| 13 | Offline Mobile & Sync | Offline-first collector, sync, conflict handling | Partially Implemented | No change |
| 14 | Risk Scoring & Credit Assessment | Customer scoring engine (score, level, reasons) | Not Implemented | **Risk Engine** (Part B.5) — make `customer_scores` active |
| 15 | Audit Trail & Compliance | Immutable audit of meaningful operations | Partially Implemented | No change |
| 16 | API Security & Rate Limiting | Throttling, headers, idempotency | Implemented | No change |
| 17 | Backup, Recovery & Restore | Automated backup, tested restore | Partially Implemented | No change |
| 18 | Monitoring & Observability | Health, metrics, alerting | Partially Implemented | No change |
| 19 | Deployment & CI/CD | Build/test/deploy automation | Partially Implemented | No change |
| 20 | Performance & Scalability | Verified scaling path, load testing | Needs Verification | No change |

---

## Part B — Approved v1.2.0 Direction

**Release theme: Real Data Foundation + Risk Engine + Daily Work Queue.**

### B.1 — Excel Import Profiles

The import pipeline must support the following named profiles. Profile **detection** is automatic (by file signature/content) with explicit confirmation at upload time.

| # | Profile ID | Meaning | v1.2.0 status |
|---|---|---|---|
| 1 | `CUSTOMER_MASTER` | Customer master data (codes, names, contacts) | **In scope** |
| 2 | `CUSTOMER_BALANCE_SUMMARY` | Customer balance summary (per-currency balances) | **In scope** |
| 3 | `DEBT_AGING_SUMMARY` | Debt aging summary (aggregate aging buckets) | **In scope** |
| 4 | `DEBT_AGING_DETAILS` | Debt aging details (per-customer aging buckets) | **In scope** |
| 5 | `CUSTOMER_STATEMENT_DETAILS` | Customer account statement (existing built-in format) | **In scope** (existing) |
| 6 | `ITEM_ANALYSIS_FUTURE` | Product/item-level analysis | **Out of scope for v1.2.0** (remains future scope) |

### B.2 — Real File Format Support

| Requirement | Detail |
|---|---|
| **Real XLSX** | Genuine `.xlsx` workbooks (openpyxl-compatible). Already supported. |
| **Tab-delimited `.xls` exports** | Files exported from the legacy system as `.xls` that are actually **tab-delimited text**, not OLE2 binary. Must be detected and parsed. |
| **Arabic encoding** | Encoded in Windows Arabic codepage, **CP1256 by default** (ratified — Part F.1). On decode failure, log a clear import error; never silently corrupt Arabic text. |

### B.3 — Explicit Exclusions

| Exclusion | Rationale |
|---|---|
| **Advances/loans file** | The advances/loans file is **not part of customer debt collection scope** and must not feed aging or risk inputs. |
| `ITEM_ANALYSIS_FUTURE` | Product/item analytics remain future scope. |
| Push notifications (FCM/APNS), full Reports module + PDF/Excel exports, major UI/UX redesign, WhatsApp API automation, production deployment changes, microservices/GraphQL/multi-tenant, product/item analytics | Excluded from v1.2.0. |

### B.4 — Debt Aging (source of truth)

- Stop relying **only** on estimated aging (oldest-transaction heuristic) **where real aging files exist** (`DEBT_AGING_SUMMARY` / `DEBT_AGING_DETAILS`).
- Imported debt-aging data becomes the **source** for aging reports and risk inputs.
- Where no real aging file is available, the estimated aging may remain as a fallback and must be clearly labeled `estimated`.

### B.5 — Risk Engine

- Make the `customer_scores` table **active** (it currently exists but nothing writes it).
- Calculate and **persist** per-customer: risk score, risk level, and human-readable reasons.
- **Connect** the persisted score to: Customer360 (`latestScore`), task prioritization, and customer filters.
- Risk features must not remain dead code.

### B.6 — Daily Work Queue

- Generate a **real, prioritized daily collector list**.
- Reason sources to include: due promises, overdue promises, aging risk, high balances, no follow-up, needs visit, escalation cases.
- **Deduplication:** avoid duplicate daily tasks for the same customer/reason.

### B.7 — Dashboard KPIs

- Replace hard-coded `null` today-KPIs (`followupsToday`, `promisesDueToday`, `collectionsToday`) with **real computed values**.
- Where a value is legitimately empty, return a **documented empty-state** (not `null` placeholder, no mock data).

### B.8 — v1.2.0 PR Breakdown (implementation order)

| PR | Scope |
|---|---|
| 1 | APMS docs alignment (this spec + re-aligned gap analysis) |
| 2 | Import profile detection/parsers (profiles 1–5, tab-delimited `.xls` + CP1256) |
| 3 | Debt aging import storage/mapping |
| 4 | Risk score calculation service (writes `customer_scores`) |
| 5 | Daily work queue generation |
| 6 | Customer360 + tasks integration |
| 7 | Dashboard KPI fixes |
| 8 | Tests and final delivery report |

---

## Part C — Chapter Requirements (normative intent)

### Chapter 1 — Organization & Branch Management
- Org → branch → user hierarchy with settings at each level. Settings list ratified (Part F.6).
- Branch-scoped analytics. **v1.2.0:** out of scope.

### Chapter 2 — Users, Roles & Permissions (RBAC)
- Granular permissions; guards on all protected operations; admin UI for users/roles/collectors/branches.
- Status: Implemented. RBAC-first ratified (Part F.7): no rebuild; verify import/risk/tasks/dashboard/customer access are permission-protected.

### Chapter 3 — Authentication & Sessions
- Login/logout/refresh/me; opaque refresh tokens hashed at rest; Argon2id; throttling; helmet; Swagger disabled in prod.
- Status: Implemented. MFA/SSO out of scope for v1.2.0 (Part F.8); future security roadmap.

### Chapter 4 — Customers & 360° View
- Profile, balances, statement history, contacts, call/SMS/WhatsApp, map (current).
- **v1.2.0:** surface persisted risk score (`latestScore`) + real aging (where imported) on Customer360.

### Chapter 5 — Multi-Currency Balances
- Per-currency debtor/creditor/zero buckets; dynamic currency list.
- **v1.2.0:** aging summary per currency feeds risk inputs. FX rates/conversion out of scope.

### Chapter 6 — Collections Management
- Collection records, GPS tagging, receipt upload, `collection_created` notification.
- **v1.2.0:** no structural change; consumes risk/aging inputs.

### Chapter 7 — Follow-ups & Promises
- Follow-up log; promises with due dates; overdue tracking.
- **v1.2.0:** feed Daily Work Queue (due + overdue promises); fix today-KPI.

### Chapter 8 — Tasks & Collector Assignments
- Task CRUD + assignment; **risk-based prioritization must become live** (currently inert because `customer_scores` is never written).
- **v1.2.0:** Daily Work Queue generation (see B.6) with dedup by customer+reason.

### Chapter 9 — Excel Import Pipeline
- Multi-profile detection (Part B.1); real XLSX + tab-delimited `.xls` + CP1256 (Part B.2); dry-run + preview + idempotency + balance reconciliation (existing) retained.
- **v1.2.0:** the core work area (PR 2 + 3).

### Chapter 10 — Dashboard & KPIs
- Operational KPIs. **v1.2.0:** real today-KPIs + documented empty states (PR 7).

### Chapter 11 — Reports & Analytics
- Not Implemented. **v1.2.0:** explicitly **out of scope** (future release; needs owner-scoped report list).

### Chapter 12 — Notifications & Alerts
- In-app notifications with deep links (current). Push (FCM/APNS) and alert rules: **out of scope for v1.2.0**.

### Chapter 13 — Offline Mobile & Sync
- SQLite cache, offline queue, sync-context, GPS tagging (current). Conflict resolution/background GPS: future.

### Chapter 14 — Risk Scoring & Credit Assessment
- Not Implemented (table + read path exist; no writer). **v1.2.0:** Risk Engine per Part B.5 (PR 4).

### Chapter 15 — Audit Trail & Compliance
- Audit module + admin/audit page. Retention ratified (Part F.9): retain indefinitely, no delete/mutation.

### Chapter 16 — API Security & Rate Limiting
- ThrottlerGuard, helmet, idempotency, opaque tokens. Status: Implemented.
- Upload validation ratified (Part F.10): extension/MIME/size/hash + error logging in v1.2.0; virus scanning at v1.6.0.

### Chapter 17 — Backup, Recovery & Restore
- Prod cron pg_dump (02:00, 30-day retention), restore script. Off-site backup: future.

### Chapter 18 — Monitoring & Observability
- `/health` family + docker healthchecks. Metrics/APM/alerting: future.

### Chapter 19 — Deployment & CI/CD
- Single ci.yml (typecheck/lint/build/unit tests + docker build). E2E-in-CI + deploy job: future.

### Chapter 20 — Performance & Scalability
- Status: **Needs Verification**. Initial load-test targets ratified (Part F.11).

---

## Part D — Items Marked `Needs Owner Review`

> All items R1–R11 have been reviewed by the owner. Decisions are recorded in **Part F**. Items are now `Ratified` or `Out of Scope` per Part F.

| # | Item | Chapter | Decision | Status |
|---|---|---|---|---|
| R1 | Exact Arabic encoding of the legacy `.xls` tab-delimited exports (CP1256 assumed) | 9 / B.2 | Ratified — CP1256 default (Part F.1) | ✅ Ratified |
| R2 | Whether estimated aging may remain as a labeled fallback when no real aging file is imported | 5 / B.4 | Ratified — fallback only, labeled (Part F.2) | ✅ Ratified |
| R3 | Risk score formula and risk-level thresholds (score range, level buckets) | 14 / B.5 | Ratified — initial formula + levels (Part F.3) | ✅ Ratified |
| R4 | Daily Work Queue priority ordering between reason sources | 8 / B.6 | Ratified — 10-level priority order (Part F.4) | ✅ Ratified |
| R5 | Dedup rule confirmation: one task per (customer, reason) per day | 8 / B.6 | Ratified — one active task per Customer+Currency+TaskType+DueDate+Source (Part F.5) | ✅ Ratified |
| R6 | Org-level settings list for Chapter 1 | 1 | Ratified — minimal v1.2.0 settings list (Part F.6) | ✅ Ratified |
| R7 | Seeded-permission coverage check for UI pickers | 2 | Ratified — RBAC-first, no rebuild; verify existing perms (Part F.7) | ✅ Ratified |
| R8 | MFA/SSO future requirement | 3 | Out of scope for v1.2.0 — future security roadmap (Part F.8) | ⛔ Out of scope |
| R9 | Audit retention policy | 15 | Ratified — retain indefinitely, no delete/mutation (Part F.9) | ✅ Ratified |
| R10 | Upload virus scanning requirement | 16 | Out of scope for v1.2.0 — validation-only; virus scan at v1.6.0 (Part F.10) | ⛔ Out of scope (partial: validation in scope) |
| R11 | Load-test targets / expected volumes | 20 | Ratified — initial targets (Part F.11) | ✅ Ratified |

---

## Part F — Ratified Owner Decisions (2026-07-31)

### F.1 — R1: File formats & encoding (ratified)
- Parser must support: **(1)** real `.xlsx` Excel files, **(2)** tab-delimited `.xls` files using **Windows-1256 / CP1256** by default.
- If decoding fails, **log a clear import error**. Do **not** silently corrupt Arabic text.

### F.2 — R2: Debt aging source (ratified with restriction)
- Debt Aging files (`DEBT_AGING_SUMMARY` / `DEBT_AGING_DETAILS`) are the **official v1.2.0 source** for aging.
- Estimated aging may be used **only as a fallback** when aging files are missing, and **must be clearly marked estimated**, not official.

### F.3 — R3: Initial risk formula & levels (ratified, configurable later)
| Factor | Weight |
|---|---|
| Debt age | 25 |
| Balance amount | 20 |
| Last payment age | 15 |
| Broken promises | 15 |
| Repeated no-answer / failed communication | 10 |
| Days since last follow-up | 10 |
| Repeated grace requests | 5 |

| Score | Risk level |
|---|---|
| 0–25 | Low |
| 26–50 | Medium |
| 51–75 | High |
| 76–100 | Critical |

### F.4 — R4: Daily Work Queue priority order (ratified)
1. Overdue promise
2. Promise due today
3. Follow-up overdue by 2+ days
4. Critical risk customers
5. Customers with debt in older aging buckets, especially over 120 days
6. High balance customers without recent follow-up
7. Repeated no-answer customers
8. Customers needing visit
9. Medium-risk periodic follow-up
10. Low-priority normal follow-up

### F.5 — R5: Task dedup rule (ratified)
- Only **one active task** per: **Customer + Currency + TaskType + DueDate + Source**.
- If multiple reasons generate the same task, **merge reasons into the same task** and keep the **highest priority**.
- Do not create duplicate daily tasks for the same customer due to multiple import sources.

### F.6 — R6: Minimal v1.2.0 org settings (ratified)
- risk thresholds
- queue generation time
- no-followup days
- escalation after days
- aging bucket configuration
- max daily tasks per collector
- enabled import profiles
- active currencies

### F.7 — R7: Permissions approach (ratified — RBAC-first)
- Do **not** rebuild the permissions system in v1.2.0.
- Only **verify** that import, risk, tasks, dashboard KPIs, and customer access are protected by existing permissions.

### F.8 — R8: MFA/SSO (out of scope)
- Out of scope for v1.2.0. Move to future security roadmap.

### F.9 — R9: Audit retention (ratified)
- Audit Log retained **indefinitely** — no delete, no mutation.
- Archiving policy may be added later.

### F.10 — R10: Upload validation scope (ratified)
- Out of scope for v1.2.0: virus scanning (moves to production hardening / **v1.6.0**).
- Required in v1.2.0: file extension validation, MIME/type validation where possible, file size limit, file hash, import error logging.

### F.11 — R11: Initial load-test targets (ratified)
| Data | Target |
|---|---|
| Customers (customer master import) | 1,500+ |
| Balance rows | 1,000+ |
| Debt aging customers | 600+ |
| Debt aging document rows | 2,500+ |
| Customer statement transactions | 7,000+ |
| Import preview | completes without crash |
| Daily queue generation | completes within acceptable operational time |
| Dashboard KPIs | load without timeout |

---

## Part G — Ratification Status

- All v1.2.0 owner-review items are resolved (Part F). This document remains a living reference; new owner-review items may be added as future chapters mature.
- v1.2.0 development may proceed per the approved scope and PR plan (Part B.8).

---

## Part E — Change Control

- This document is a **ratification draft**. It becomes normative only after owner review and sign-off.
- Changes to approved scope must be recorded here.

| Rev | Date | Change | Author |
|---|---|---|---|
| v2.0-draft | 2026-07-31 | Initial ratification draft: 20-chapter structure, v1.2.0 direction, import profiles, file formats, exclusions, risk engine, daily work queue, dashboard KPIs | AI assistant (awaiting owner review) |
| v2.0-ratified | 2026-07-31 | Owner ratified R1–R11 for v1.2.0 (Part F); decisions recorded; v1.2.0 approved in principle | Owner + AI assistant |
