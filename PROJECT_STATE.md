# Project State — v1.3.0 Release Candidate

## Current Version
**الحزمة المنشورة:** v1.2.1

**الكود على `main`:** مرشح v1.3.0 بعد دمج محاور التنفيذ السبعة. لم يُنشأ tag أو إصدار v1.3 رسمي بعد.

## Release Summary
| Area | Status |
|------|--------|
| v1.2 smart debt management | ✅ imports, aging, risk, daily queue, Customer 360, assignments |
| Users & collectors administration | ✅ merged |
| RBAC roles & permissions | ✅ merged |
| Bulk assignment | ✅ merged |
| Dashboard drill-down & charts | ✅ merged |
| Data-quality dashboard | ✅ merged |
| Goods reservations | ✅ backend/domain implementation merged; UX expansion remains |
| Analytical accounts | ✅ merged |
| Parser variants and structured errors | ✅ merged and covered by Python CI tests |
| In-app notifications | ✅ list, read state, links and unread counter |
| Push notifications (FCM/APNS) | ⏳ not implemented |
| Advanced report exports (PDF/Excel) | ⏳ not implemented |

## Active pull requests

- PR #23: mandatory CI quality gates and mobile checks
- PR #24: frontend production dependency security upgrade
- PR #25: web/mobile call, SMS and WhatsApp contact actions

## Remaining before the official v1.3.0 release

- Review and merge approved open PRs; no automatic merge.
- Add PostgreSQL-backed E2E coverage to CI.
- Complete advanced reports and PDF/Excel exports.
- Complete FCM/APNS device registration and delivery.
- Finish reservations UI acceptance testing.
- Update changelog, release notes, versions and tag only after owner approval.
