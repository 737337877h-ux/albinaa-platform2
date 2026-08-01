# Project State — v1.2.0 Released

## Current Version
**v1.2.0** — إدارة المديونية الذكية (Release Candidate) (2026-08-01)

## Release Summary
| Area | Status |
|------|--------|
| Import Profiles + Debt Aging storage | ✅ APMS detection + line-hash dedup |
| Risk Score | ✅ 7 factors · recalculate endpoint |
| Daily Work Queue | ✅ generate-today + priority board |
| Customer360 Risk/Tasks | ✅ score/reasons + open tasks |
| Dashboard KPIs | ✅ real data KPIs |
| Customer Assignments | ✅ assign/unassign + task reassignment |
| Task Execution + Followup + Promise | ✅ results + promise on completion |
| Stabilization | ✅ full e2e 122/122 |
| Tests | ✅ 122 e2e + 25 unit |
| TypeScript / ESLint | ✅ 0 errors (Backend + Frontend) |
| Docker Compose | ✅ all services healthy |

## Key Files
- **Backend:** `backend/src/imports/`, `backend/src/risk/`, `backend/src/tasks/`, `backend/src/dashboard/`, `backend/src/customers/`, `backend/src/promises/`
- **Frontend:** `frontend/src/app/(app)/dashboard/`, `frontend/src/app/(app)/customers/`, `frontend/src/app/(app)/tasks/`, `frontend/src/app/(app)/imports/`
- **Docs:** `RELEASE_NOTES_v1.2.0.md`, `CHANGELOG.md`, `ROADMAP.md`

## Next (Planned — v1.3.0)
- Push notifications (FCM/APNS)
- UI/UX improvements
- Advanced financial reports
- (راجع ROADMAP.md للتفاصيل)
