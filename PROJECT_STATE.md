# Project State - Bug Fix Sprint

## Last Commit
```
f9995e7 - fix: promises endpoint /payment-promises and admin bypass assignment check
```

## Current Status
**Phase:** Bug Fix Sprint - Code Fixes Complete, Awaiting Device Retest
**Date:** 2026-07-30
**Backend:** http://192.168.83.30:3000
**Test User:** admin / ChangeMe!2026

---

## Completed Fixes

| Bug | Root cause | Fix |
|-----|-----------|-----|
| Customer360 Crash | `balances` JSON string in SQLite | `parseJsonField()` + null guards |
| Notifications Empty | Paginated `{items:[...]}` response | `data?.items ?? (Array.isArray(data) ? data : [])` |
| Dashboard Counters | Derived from empty syncData | Fetch from local SQLite |
| Collection Create Fails | `methodId` text not UUID; no collectorId | Fetch methods from API; admin bypass assignment |
| Follow-up Create Fails | `typeId` text not UUID | Fetch types/results from API |
| Receipt Upload Reject | `image/jpg` not in ALLOWED_MIME_TYPES | Added `image/jpg` to backend |
| Duplicate Customers | Full object upsert; no column filtering | `TABLE_COLUMNS` whitelist + JSON serialization |
| App Crashes | No ErrorBoundary | Added ErrorBoundary in App.tsx |
| Tasks Empty | Admin not a collector; sync fetches by collectorId | Admin auto-lookup; local SQLite |
| Promise Create Fail | Wrong endpoint `/promises` vs `/payment-promises` | Changed to `/payment-promises` |
| Admin Collection Fail | Customer assignment required | Admin `customers.read_all` bypasses assignment check |

---

## Open Items - Awaiting Physical Device Retest

1. **Customer360** - Open 3 different customers, verify no crash ✅ Should be fixed
2. **New Follow-up** - Create follow-up ✅ Reported working
3. **New Collection** - Create collection ❌ Should be fixed now (admin bypass)
4. **Upload Receipt** - Upload receipt with image/jpg
5. **Duplicate Prevention** - Verify no duplicate customers after sync
6. **Tasks** - Verify tasks appear for admin
7. **Notifications** - Verify notifications display
8. **Promise Create** - Cannot POST /promises ❌ Should be fixed now (`/payment-promises`)

---

## Build Command
```bash
cd mobile
npx eas build --platform android --profile local-test --local
```

---

## New Features (NOT in Sprint - Requires Separate Discussion)

1. Remove AED currency - make dynamic from API
2. Call/SMS/WhatsApp buttons in Customer360
3. Customer location/map display
4. Promise due date field
5. Interactive notifications with deep linking

---

## Key Files
- **Backend:** `backend/src/collections/`, `backend/src/promises/`, `backend/src/mobile/`
- **Mobile:** `mobile/src/screens/`, `mobile/src/api/endpoints.ts`, `mobile/src/store/sync-context.tsx`
- **DB:** `mobile/src/db/database.ts`, `prisma/schema.prisma`
