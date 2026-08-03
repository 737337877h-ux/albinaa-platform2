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
| Goods reservations | ✅ backend/domain and Arabic Customer 360 workflow merged |
| Analytical accounts | ✅ merged |
| Parser variants and structured errors | ✅ merged and covered by Python CI tests |
| In-app notifications | ✅ list, read state, links and unread counter |
| Push notifications (FCM/APNS) | ⏳ not implemented |
| Collection report filters & Excel-compatible export | ✅ branch/collector/date/status/currency filters and CSV export merged |
| Native PDF/XLSX exports | ⏳ not implemented |

## Recently merged delivery pull requests

- PR #23: mandatory CI quality gates and mobile checks
- PR #24: frontend production dependency security upgrade
- PR #25: web/mobile call, SMS and WhatsApp contact actions
- PR #27: backend production dependency security upgrade
- PR #28: Arabic goods-reservations workflow
- PR #29: collection filters and Excel-compatible export

## Remaining before the official v1.3.0 release

- Add PostgreSQL-backed E2E coverage to CI.
- Complete native PDF/XLSX exports and remaining advanced analytics.
- Complete FCM/APNS device registration and delivery.
- Run full staging acceptance testing for reservations, contact actions and exports.
- Update changelog, release notes, versions and tag only after owner approval.
