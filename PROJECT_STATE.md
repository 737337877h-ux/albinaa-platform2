# Project State - Bug Fix Sprint

## Last Commit
```
e7ad936 - fix: stabilize customer360 navigation notifications dashboard and collection flows
```

## Current Status
**Phase:** Bug Fix Sprint - In Progress
**Date:** 2026-07-30
**Backend:** http://192.168.83.30:3000
**Test User:** admin / ChangeMe!2026

---

## Completed Fixes

### Customer360 Crash
- **Root cause:** `customer.balances` stored as JSON string in SQLite; `Number(string)` and `.map()` on non-array
- **Fix:** `parseJsonField()` utility + null guards in customer-360.tsx
- **Files:** `mobile/src/screens/customer-360.tsx`, `mobile/src/utils/errors.ts`

### Notifications Empty
- **Root cause:** Backend returns `{items:[...], page, total}` paginated; Mobile expects flat array
- **Fix:** Changed to `data?.items ?? (Array.isArray(data) ? data : [])`
- **Files:** `mobile/src/screens/notifications.tsx`

### Dashboard Counters Wrong
- **Root cause:** Counters derived from syncData (empty for admin - not a collector)
- **Fix:** Fetch directly from local SQLite tables
- **Files:** `mobile/src/screens/dashboard.tsx`

### Collection Creation Fails (400)
- **Root cause:** Mobile sends `methodId: 'cash'` (text) instead of UUID; Backend requires collectorId for admin
- **Fix:** Fetch `collectionMethods` from API; Backend auto-assigns collectorId for admin
- **Files:** `mobile/src/screens/new-collection.tsx`, `backend/src/collections/collections.service.ts`

### Follow-up Creation Fails (400)
- **Root cause:** Mobile sends `typeId` as text; Backend requires UUID `resultId`
- **Fix:** Fetch `followupTypes` and `followupResults` from API; submit proper UUIDs
- **Files:** `mobile/src/screens/new-followup.tsx`, `mobile/src/api/endpoints.ts`

### Receipt Upload Rejects image/jpg
- **Root cause:** Backend ALLOWED_MIME_TYPES only has `image/jpeg`; Mobile saves as `.jpg`
- **Fix:** Added `image/jpg` and `image/pjpeg` to backend; normalize MIME in mobile
- **Files:** `backend/src/mobile/mobile.controller.ts`, `mobile/src/api/endpoints.ts`

### Duplicate Customers
- **Root cause:** `upsert('customers', c)` using full object; SQLite `balances` is TEXT; no deduplication
- **Fix:** `TABLE_COLUMNS` whitelist, `pickColumns()` to filter fields, proper JSON serialization
- **Files:** `mobile/src/store/sync-context.tsx`

### App Crashes on Navigation
- **Root cause:** Unhandled exceptions propagate to root
- **Fix:** Added `ErrorBoundary` class component in App.tsx
- **Files:** `mobile/App.tsx`

### Tasks Empty for Admin
- **Root cause:** Admin is not a Collector; tasks.service returns `emptyTodayBoard()`; sync fetches by collectorId
- **Fix:** Admin auto-lookup via customer assignment (backend); local SQLite fallback
- **Files:** `backend/src/tasks/tasks.service.ts`, `mobile/src/store/sync-context.tsx`

---

## Open Items - Require Physical Testing

1. **Customer360** - Open 3 different customers, verify no crash
2. **New Follow-up** - Create follow-up for a customer
3. **New Collection** - Create collection, verify success
4. **Upload Receipt** - Upload receipt with image/jpg
5. **Duplicate Prevention** - Verify no duplicate customers after sync
6. **Tasks** - Verify tasks appear for admin
7. **Notifications** - Verify notifications display

---

## Next Step
1. Build new APK: `cd mobile && npx eas build --platform android --profile preview`
2. Test on physical Android device
3. Record video demonstration

---

## Key Files
- **Backend:** `backend/src/collections/`, `backend/src/promises/`, `backend/src/mobile/`
- **Mobile:** `mobile/src/screens/`, `mobile/src/api/endpoints.ts`, `mobile/src/store/sync-context.tsx`
- **DB:** `mobile/src/db/database.ts`, `prisma/schema.prisma`
