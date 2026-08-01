# Project State — v1.2.1 Released

## Current Version
**v1.2.1** — صفحة الإشعارات الكاملة (Web Hotfix) (2026-08-01)

## Release Summary
| Area | Status |
|------|--------|
| Notifications page | ✅ full list + kind/detail + read state + customer link |
| Mark as read | ✅ per-notification (PATCH `/notifications/:id/read`) |
| Mark all as read | ✅ header action (PATCH `/notifications/read-all`) |
| Unread-only filter | ✅ with unread counter |
| Pagination | ✅ 25/page via `GET /notifications` |
| Bell sync | ✅ badge refreshes after any read action |
| Tests | ✅ no schema/migration/dependency changes |
| TypeScript / ESLint | ✅ 0 errors (Backend + Frontend) |

## Key Files
- **Backend:** `backend/src/notifications/` (unchanged — v1.2.1 uses existing endpoints)
- **Frontend:** `frontend/src/app/(app)/notifications/`, `frontend/src/components/notifications-menu.tsx`
- **Docs:** `RELEASE_NOTES_v1.2.1.md`, `RELEASE_NOTES_v1.2.0.md`, `CHANGELOG.md`, `ROADMAP.md`

## Next (Planned — v1.3.0)
- Push notifications (FCM/APNS)
- UI/UX improvements
- Advanced financial reports
- (راجع ROADMAP.md للتفاصيل)
