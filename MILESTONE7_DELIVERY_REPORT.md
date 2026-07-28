# Milestone 7 — Delivery Report (Final)

**Commit**: `5b93c7c+` (latest including review fixes)
**Branch**: `main`
**Remote**: `https://github.com/737337877h-ux/albinaa-platform2.git`

---

## 1. Test Results

### Backend (NestJS)

| Suite | Result | Notes |
|---|---|---|
| `npm run test:unit` | **6/6 pass** | `parser.service.spec.ts` |
| `npm run test:e2e` | **109/109 pass** | 7 suites, all pass |
| `npm run typecheck` | **0 errors** | Clean TypeScript |
| `npm run build` | **Pass** | NestJS build |
| **`npm run lint`** | **✅ 0 errors, 0 warnings** | Fixed — ESLint config + deps added |

### Frontend (Next.js 14)

| Check | Result | Notes |
|---|---|---|
| `npm run typecheck` | **0 errors** | Clean TypeScript |
| `npm run test` | **29/29 pass** | 4 test files |
| `npm run build` | **Pass** | 20 pages, compiled OK |
| `npm run lint` | **Pass** | Uses `next lint` with `.eslintrc.json` |

### Docker

| Service | Status | Ports |
|---|---|---|
| `albinaa-db` | **Healthy** | `0.0.0.0:6543→5432/tcp` |
| `albinaa-backend` | **Healthy** | `0.0.0.0:3000→3000/tcp` |
| `albinaa-frontend` | **Healthy** | `0.0.0.0:3001→3001/tcp` |
| `albinaa-nginx` | **Healthy** | `80/tcp, 443/tcp` |
| `albinaa-backup` | **Up** | PG backup container (production only) |

### E2E Test Suites (7 suites, 109 tests — all passing)

| File | Tests | Coverage |
|---|---|---|
| `app.e2e-spec.ts` | 5 | App health |
| `customers.e2e-spec.ts` | 20 | Full CRUD |
| `collection-workflow.e2e-spec.ts` | 18 | Full workflow |
| `dashboard-review-fixes.e2e-spec.ts` | 6 | Dashboard fixes |
| `imports.e2e-spec.ts` | 15 | Import workflow |
| `m5-review-fixes.e2e-spec.ts` | 10 | Review regression |
| **`m7-admin-mobile.e2e-spec.ts`** | **35** | **Admin + Mobile API** |

---

## 2. Full API Routes

| Module | Method | Path | Auth | Permission |
|---|---|---|---|---|
| **Auth** | | | | |
| | `POST` | `/auth/login` | Public | — (5/min throttle) |
| | `POST` | `/auth/refresh` | Public | — (10/min throttle) |
| | `POST` | `/auth/logout` | JWT | — |
| | `GET` | `/auth/me` | JWT | — |
| | `POST` | `/auth/change-password` | JWT | — |
| **Users** | | | | |
| | `GET` | `/users` | JWT | `users.manage` |
| | `GET` | `/users/:id` | JWT | `users.manage` |
| | `POST` | `/users` | JWT | `users.manage` |
| | `PATCH` | `/users/:id` | JWT | `users.manage` |
| | `PATCH` | `/users/:id/status` | JWT | `users.manage` |
| | `POST` | `/users/:id/reset-password` | JWT | `users.manage` |
| | `POST` | `/users/:id/roles` | JWT | `users.manage` |
| | `DELETE` | `/users/:id/roles/:roleId` | JWT | `users.manage` |
| **Roles** | | | | |
| | `GET` | `/roles` | JWT | `users.manage` |
| | `GET` | `/permissions` | JWT | `users.manage` |
| | `GET` | `/roles/:id/permissions` | JWT | `users.manage` |
| | `POST` | `/roles/:id/permissions` | JWT | `users.manage` |
| | `DELETE` | `/roles/:id/permissions/:permissionId` | JWT | `users.manage` |
| **Branches** | | | | |
| | `GET` | `/organizations/current` | JWT | — |
| | `GET` | `/branches` | JWT | — |
| | `GET` | `/branches/:id` | JWT | — |
| | `POST` | `/branches` | JWT | `settings.manage` |
| | `PATCH` | `/branches/:id` | JWT | `settings.manage` |
| | `PATCH` | `/branches/:id/status` | JWT | `settings.manage` |
| **Currencies** | | | | |
| | `PATCH` | `/currencies/:code` | JWT | `settings.manage` |
| **Settings** | | | | |
| | `GET` | `/settings/:key` | JWT | `settings.manage` |
| | `PUT` | `/settings/:key` | JWT | `settings.manage` |
| | `DELETE` | `/settings/:key` | JWT | `settings.manage` |
| **Audit** | | | | |
| | `GET` | `/audit-logs` | JWT | `audit.read` |
| **Collectors** | | | | |
| | `GET` | `/collectors` | JWT | `users.manage` |
| | `GET` | `/collectors/:id` | JWT | `users.manage` |
| | `POST` | `/collectors` | JWT | `users.manage` |
| | `PATCH` | `/collectors/:id` | JWT | `users.manage` |
| **Mobile** | | | | |
| | `POST` | `/mobile/sync` | JWT | — |
| | `POST` | `/mobile/gps` | JWT | — |
| | `POST` | `/mobile/gps/batch` | JWT | — |
| | `POST` | `/mobile/upload-receipt` | JWT | — (20/min throttle) |
| | `GET` | `/mobile/receipts/:id` | JWT | Org-scoped |
| | `GET` | `/mobile/customers` | JWT | Org-scoped |
| | `GET` | `/mobile/customers/:id` | JWT | Org-scoped |
| **Customers** | | | | |
| | `GET` | `/customers/duplicates` | JWT | `duplicates.review` |
| | `PATCH` | `/customers/duplicates/:pairId` | JWT | `duplicates.review` |
| | Multi | `/customers/:id/*` | JWT | Various |
| **Collections** | | | | |
| | Multi | `/collections/*` | JWT | Various |
| **Followups** | | | | |
| | Multi | `/followups/*` | JWT | Various |
| **Promises** | | | | |
| | Multi | `/promises/*` | JWT | Various |
| **Tasks** | | | | |
| | `GET` | `/tasks/today` | JWT | `tasks.manage` |
| | `PATCH` | `/tasks/:id/complete` | JWT | `tasks.manage` |
| **Dashboard** | | | | |
| | `GET` | `/dashboard/summary` | JWT | `reports.read` |
| | `GET` | `/dashboard/collector` | JWT | `tasks.manage` |
| **Imports** | | | | |
| | `POST` | `/imports/upload` | JWT | `imports.run` |
| | `POST` | `/imports/:id/execute` | JWT | `imports.run` |
| | `GET` | `/imports/:id` | JWT | `imports.read` |
| | `GET` | `/imports/:id/report` | JWT | `imports.read` |
| | `GET` | `/imports/:id/errors` | JWT | `imports.read` |
| **Health** | | | | |
| | `GET` | `/health` | Public | — |
| | `GET` | `/health/database` | Public | — |
| | `GET` | `/health/ready` | Public | — |
| | `GET` | `/health/live` | Public | — |
| **Notifications** | | | | |
| | `GET` | `/notifications` | JWT | — |
| | `PATCH` | `/notifications/read-all` | JWT | — |
| | `PATCH` | `/notifications/:id/read` | JWT | — |
| **Assignments** | | | | |
| | `POST` | `/assignments` | JWT | `customers.read` |
| | `PATCH` | `/assignments/:id/end` | JWT | `customers.transfer` |
| | `POST` | `/assignments/bulk` | JWT | `customers.transfer` |

---

## 3. Permissions List (21 permissions)

| Code | Arabic Description | Required By |
|---|---|---|
| `customers.read` | عرض العملاء | Customer, Collection, Followup, Promise controllers |
| `customers.read_all` | رؤية جميع العملاء | Customer controller (data scoping) |
| `customers.write` | تعديل بيانات العملاء | Customer controller |
| `customers.transfer` | نقل العملاء بين المحصلين | Assignment controller |
| `balances.read` | عرض الأرصدة | Customer controller |
| `collections.create` | تسجيل تحصيل | Collection controller |
| `collections.reverse` | عكس تحصيل بإجراء موثق | Collection controller |
| `collections.approve` | اعتماد التحصيلات | Collection controller |
| `cash.receive` | تأكيد استلام النقدية في الصندوق | Collection controller |
| `followups.create` | تسجيل متابعة | Followup controller |
| `promises.create` | تسجيل وعد سداد | Promise controller |
| `tasks.manage` | إدارة المهام | Task, Dashboard controllers |
| `imports.run` | تنفيذ استيراد Excel | Import controller |
| `imports.read` | عرض سجل الاستيراد | Import controller |
| `reconciliation.review` | مراجعة واعتماد التسويات | (Future) |
| `reports.read` | عرض التقارير | Dashboard controller |
| `reports.export` | تصدير التقارير | (Future) |
| `users.manage` | إدارة المستخدمين والصلاحيات | Users, Roles, Collectors controllers |
| `settings.manage` | إدارة الإعدادات | Settings, Currencies, Branches controllers |
| `audit.read` | عرض سجل التدقيق | Audit controller |
| `duplicates.review` | مراجعة حالات تشابه العملاء | Customer controller |

### Predefined Roles

| Role | Permissions |
|---|---|
| **مدير النظام** (System Admin) | All 21 permissions |
| **مدير المديونية** (Credit Manager) | customers.read, customers.read_all, customers.transfer, balances.read, followups.create, promises.create, tasks.manage, reports.read, reports.export, duplicates.review |
| **المحصل** (Collector) | customers.read, balances.read, followups.create, promises.create, collections.create, tasks.manage |
| **المحاسب** (Accountant) | customers.read, customers.read_all, balances.read, collections.approve, imports.run, imports.read, reconciliation.review, reports.read, reports.export |
| **أمين الصندوق** (Cashier) | cash.receive, collections.approve, balances.read |

---

## 4. Users / Roles / Branches APIs — Status Clarification

**All three modules have full, real Prisma-based CRUD APIs — not mock data, not stale endpoints.**

### Users API
- File: `backend/src/users/users.controller.ts` (95 lines) + `users.service.ts` (200 lines)
- Endpoints: GET (list), GET :id, POST (create with duplicate check + password hashing), PATCH :id, PATCH :id/status (with last-admin protection), POST :id/reset-password, POST :id/roles (grant), DELETE :id/roles/:roleId (revoke with last-admin protection)
- Security: `@RequirePermissions('users.manage')` on entire controller
- Audit logging on all mutations

### Roles API
- File: `backend/src/roles/roles.controller.ts` (56 lines) + `roles.service.ts` (108 lines)
- Endpoints: GET /roles (with user count + permission count), GET /permissions, GET /roles/:id/permissions, POST /roles/:id/permissions (upsert-based, idempotent), DELETE /roles/:id/permissions/:permissionId
- Protection: System roles (مدير النظام) require `settings.manage` additionally
- Security: `@RequirePermissions('users.manage')` on entire controller

### Branches API
- File: `backend/src/branches/branches.controller.ts` (66 lines) + `branches.service.ts` (91 lines)
- Endpoints: GET /organizations/current, GET /branches, GET /branches/:id, POST /branches (requires `settings.manage`), PATCH /branches/:id (requires `settings.manage`), PATCH /branches/:id/status (requires `settings.manage`)
- Duplicate name validation, audit logging

### Frontend Pages
All three admin pages (`admin/users/`, `admin/roles/`, `admin/branches/`) use the real API via `api()` helper with Bearer token auth and `@tanstack/react-query`.

---

## 5. Mobile Sync Architecture

### syncToken Structure
- **Type**: ISO 8601 timestamp string (e.g., `"2026-07-29T01:30:00.123Z"`)
- **Generation**: Created server-side as `new Date().toISOString()` at the end of each sync
- **Storage**: Client-managed (sent with next sync request as `lastSyncToken`)

### Sync Flow
```
Mobile App                    Server
    |                           |
    |--- POST /mobile/sync ---->|
    |    {lastSyncToken?}       |  Parse `since = new Date(lastSyncToken)`
    |                           |  If no token: full sync (all eligible data)
    |                           |  If has token: incremental (createdAt >= since)
    |                           |
    |<--- 200 OK --------------|
    |    {syncToken,            |
    |     serverTime,           |
    |     tasks: [...],         |
    |     customers: [...],     |
    |     followups: [...],     |
    |     promises: [...],      |
    |     collections: [...]}   |
    |                           |
    |  Store syncToken locally  |
    |  (use on next sync call)  |
```

### What Gets Synced (backend/src/mobile/mobile.service.ts:63-147)

| Entity | Filter | Limit |
|---|---|---|
| Tasks | assigned to collector, due ≥ today, `createdAt >= since` | Unlimited |
| Customers | All (if `customers.read_all`) or assigned to collector | Unlimited |
| Followups | Created by user, not deleted, `followupAt >= since` | 50 |
| Payment Promises | For collector, `createdAt >= since` | 50 |
| Collections | By collector, `collectedAt >= since` | 50 |

### Idempotency & Conflict Resolution

**Current state**: No explicit conflict resolution mechanism exists.

- **syncToken is a timestamp** — it's a "pull what's newer than X" pattern
- **No client operation IDs** — the server does not track which operations the client has already applied
- **No `updatedAt` tracking** — sync relies on `createdAt`, `followupAt`, `collectedAt` timestamps (no `updatedAt` columns on most tables)
- **No last-write-wins** — not applicable since sync is read-only pull

**For the React Native app with offline-first support, the following should be implemented in Milestone 7 Part 3:**

1. **Client Operation IDs** — Each mutation (create/update) from mobile carries a unique UUID
2. **Idempotency Keys** — Server stores processed op IDs to prevent double-application
3. **Conflict Detection** — Compare `updatedAt` timestamps; if mobile's version is stale, return conflict
4. **Conflict Resolution** — Strategy TBD (last-write-wins, server-wins, or manual merge)

---

## 6. Security Documentation

### File Upload & Storage

| Aspect | Detail |
|---|---|
| **Storage Location** | `UPLOAD_DIR` env var (defaults to `backend/uploads/`) |
| **Docker Volume** | `albinaa_uploads:/data/uploads` (code now reads `UPLOAD_DIR` env var) |
| **Public Access** | ❌ Not publicly accessible — no static serving configured |
| **Download** | `GET /mobile/receipts/:id` — requires JWT + org-scoped authorization |
| **File Types Allowed** | `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf` |
| **Extensions Allowed** | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.pdf` |
| **Max File Size** | 10 MB (configurable in multer `limits`) |
| **Authorization** | Collection ownership verified against user's organization |
| **Cleanup on Failure** | `fs.unlink` called if DB transaction fails or collection not found |
| **Path Traversal** | Prevented — filenames are random (`${timestamp}-${random}.${ext}`) |
| **Virus Scan** | ❌ Not implemented — recommended for future enhancement |
| **Rate Limiting** | ✅ 20 requests/minute per user (`@Throttle`) |

### Virus Scanning (Future Enhancement)
For production, integrate ClamAV via `clamd`:
```bash
# docker-compose addition
clamav:
  image: clamav/clamav:stable
  volumes:
    - albinaa_uploads:/data/uploads:ro
```
Then add a scanning step in `mobile.controller.ts` before saving. This is **out of scope** for M7.

---

## 7. Backup & Restore

Fully documented in [`BACKUP.md`](./BACKUP.md). Summary:

| Feature | Detail |
|---|---|
| **Automatic Backup** | Daily at 2:00 AM via cron in `backup` container |
| **Backup Command** | `pg_dump --format=custom --compress=9` → gzipped `.sql.gz` |
| **Storage** | Docker volume `albinaa_backups` (mounted at `/backups`) |
| **Retention** | Configured via `BACKUP_RETENTION_DAYS` (default: 30 days) |
| **Manual Backup** | `docker compose -f docker-compose.prod.yml exec backup /usr/local/bin/backup.sh` |
| **Restore** | `docker compose -f docker-compose.prod.yml exec backup /usr/local/bin/restore.sh /backups/albinaa_<timestamp>.sql.gz` |
| **Verification** | `gunzip -t <backup>.sql.gz` |
| **Off-site Sync** | AWS S3 or rsync (documented in BACKUP.md) |
| **Disaster Recovery** | Full instructions in BACKUP.md (stop all → restore → run migrations → restart) |

### Backup Script (`scripts/backup.sh`)
```bash
pg_dump -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom --compress=9 > "/backups/albinaa_$(date +%Y%m%d_%H%M%S).sql.gz"
```

### Restore Script (`scripts/restore.sh`)
- Interactive (requires typing "RESTORE" to confirm)
- Drops + recreates database
- `gunzip -c | psql` restore
- Reminds to run `prisma migrate deploy` after restore

---

## 8. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Mobile App (React Native)              │
│              (Milestone 7 Part 3 — not yet built)           │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS / JWT
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Nginx Reverse Proxy (port 80/443)               │
│  ┌───────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐  │
│  │ /api/* →   │  │ /docs →  │  │ /health → │  │  /* →    │  │
│  │ backend    │  │ backend  │  │ backend   │  │ frontend │  │
│  └───────────┘  └──────────┘  └───────────┘  └──────────┘  │
└──────┬──────────────────────────────────────────────────┬───┘
       │                                                   │
       ▼                                                   ▼
┌──────────────────┐                          ┌─────────────────────┐
│  NestJS API      │                          │  Next.js 14         │
│  (TypeScript)    │◄──── JWT Auth ──────────►│  (Frontend SSR)     │
│                  │                          │                     │
│  • Auth/JWT      │                          │  • 20 pages         │
│  • Users CRUD    │                          │  • Admin dashboard  │
│  • Roles RBAC    │                          │  • Collections      │
│  • Branches      │                          │  • Customers        │
│  • Collections   │                          │  • Followups        │
│  • Mobile Sync   │                          │  • Promises         │
│  • GPS Tracking  │                          │  • Imports          │
│  • File Upload   │                          │  • Mobile data      │
│  • Dashboard     │                          │    (React Native    │
│  • Audit Logging │                          │     compat views)   │
│  • Rate Limiting │                          └─────────────────────┘
└──────┬───────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│                PostgreSQL 16                                 │
│  • Prisma ORM                                                │
│  • 13+ tables (users, customers, collections, followups,    │
│    promises, tasks, assignments, attachments, gps_logs,     │
│    audit_logs, settings, currencies, roles, permissions,    │
│    branches, organizations, import_jobs, notifications)      │
│  • 7 migrations applied                                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  Upload Storage                              │
│  Docker volume: albinaa_uploads → /data/uploads             │
│  Types: images (jpeg/png/gif/webp) + PDF                   │
│  Max size: 10 MB                                            │
│  Download: GET /mobile/receipts/:id (JWT + org check)      │
│  Virus scan: ❌ (recommended for production)                 │
└─────────────────────────────────────────────────────────────┘

Additional Infrastructure:
┌────────────────┐  ┌──────────────────┐  ┌─────────────────┐
│  Docker Compose │  │  Backup Service  │  │  Cron: pg_dump  │
│  5 containers   │  │  postgres:16     │  │  daily at 2 AM  │
└────────────────┘  └──────────────────┘  └─────────────────┘
```

---

## 9. Prisma Migrations (7 applied)

| # | Migration | Date | Description |
|---|---|---|---|
| 1 | `20260717000000_init` | 2026-07-17 | Initial schema (users, orgs, customers, etc.) |
| 2 | `20260718000000_auth_sessions` | 2026-07-18 | Refresh tokens, sessions |
| 3 | `20260719000000_collection_workflow` | 2026-07-19 | Collections, followups, promises |
| 4 | `20260719120000_m5_review_fixes` | 2026-07-19 | Milestone 5 review fixes |
| 5 | `20260728000000_add_performance_indexes` | 2026-07-28 | Performance indexes |
| 6 | `20260728210653_add_gps_logs` | 2026-07-28 | GPS tracking tables |
| 7 | `20260729210953_fix_audit_entityid_type` | **2026-07-29** | Fix `audit_logs.entity_id` UUID → TEXT |

---

## 10. Swagger API Documentation

- **URL**: `/docs` (dev mode) or not available in production (`NODE_ENV=production`)
- **Status**: ✅ Fully configured via `@nestjs/swagger`
- **Auth**: Bearer JWT with `persistAuthorization: true`
- **Note**: Docker runs in `production` mode, so Swagger is disabled. For dev, run backend with `NODE_ENV=development`.

### Screenshots
The admin pages are accessible at:
- http://localhost/admin/audit
- http://localhost/admin/settings
- http://localhost/admin/currencies
- http://localhost/admin/collectors
- http://localhost/admin/roles
- http://localhost/admin/users
- http://localhost/admin/branches
- http://localhost/dashboard
- http://localhost/customers
- http://localhost/collections
- http://localhost/followups
- http://localhost/promises
- http://localhost/tasks
- http://localhost/imports
- http://localhost/notifications

All 20 pages compile successfully (verified by `next build`).

---

## 11. Known Gaps & Recommendations

| Issue | Severity | Status |
|---|---|---|
| ~~Backend ESLint fails~~ | ~~Low~~ | **✅ Fixed** — config + deps added |
| ~~Rate limiting on upload~~ | ~~Low~~ | **✅ Fixed** — 20 req/min |
| ~~Upload path mismatch~~ | ~~Low~~ | **✅ Fixed** — uses `UPLOAD_DIR` env var |
| ~~No receipt download endpoint~~ | ~~Low~~ | **✅ Fixed** — `GET /mobile/receipts/:id` |
| No file type magic byte validation | Low | MIME check sufficient for now |
| No virus scan on upload | Medium | Add ClamAV for production |
| No offline sync conflict resolution | Medium | For Milestone 7 Part 3 |
| No client operation IDs | Medium | For Milestone 7 Part 3 |
| Swagger disabled in production | Low | Docs exist, enable via NODE_ENV |
| No E2E tests for Users/Roles/Branches CRUD | Medium | Admin pages + E2E coverage needed |

---

## 12. Files Changed (Complete)

### Backend Changes
| File | Change |
|---|---|
| `backend/.eslintrc.json` | **NEW** — ESLint config for TypeScript |
| `backend/package.json` | Added `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin` |
| `backend/src/mobile/mobile.controller.ts` | MIME whitelist, ext filter, `@Throttle(20/min)`, `UPLOAD_DIR` env, download endpoint |
| `backend/src/mobile/mobile.service.ts` | Collection ownership check, file cleanup, `downloadReceipt()` method, `StreamableFile` |
| `backend/src/main.ts` | Removed unused `VersioningType` import |
| `backend/src/imports/imports.service.ts` | Removed unused `ParsedAccount` import, prefixed unused vars with `_` |
| `backend/src/imports/parser.service.spec.ts` | Prefixed unused `cmd` → `_cmd` |
| `backend/src/tasks/tasks.service.ts` | Removed unused `assignedIds` |
| `backend/test/m7-admin-mobile.e2e-spec.ts` | 35 tests for Milestone 7 admin + mobile |

### Prisma
| File | Change |
|---|---|
| `prisma/schema.prisma` | `audit_logs.entityId` — removed `@db.Uuid` |
| `prisma/migrations/20260729210953_fix_audit_entityid_type/migration.sql` | **NEW** — ALTER COLUMN type change |

### Frontend
| File | Change |
|---|---|
| `frontend/src/components/ui/data-state.tsx` | `emptyTitle` made optional |

### Documentation
| File | Change |
|---|---|
| `MILESTONE7_DELIVERY_REPORT.md` | **Updated** — comprehensive final report |

---

## 13. Decision / Next Steps

**Milestone 7 (Administration + Mobile API) is ready for approval.**

After approval:
1. **Milestone 7 Part 3** — React Native Collector App + Offline Sync
   - Build mobile app with offline-first architecture
   - Implement client operation IDs + idempotency
   - Implement conflict detection & resolution
   - Connect to existing Mobile API endpoints
2. **Future enhancements** (post M7):
   - Add Virus scan (ClamAV)
   - Add E2E tests for Users/Roles/Branches
   - Enable Swagger in staging environments
