# Project State — v1.3.0 Release Candidate

## Current Version
**الحزمة المنشورة:** v1.2.1

**العمل الحالي:** مرشح v1.3.0 على فرع `codex/android-offline-lan` وPR #34 مسودة. لم يُدمج تلقائيًا، ولم يُنشأ tag أو إصدار v1.3 رسمي.

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
| Push notifications (FCM/APNS) | ✅ device registration and opt-in Expo delivery; real credentials/UAT pending |
| Collection report filters & Excel-compatible export | ✅ branch/collector/date/status/currency filters and CSV export merged |
| Native PDF/XLSX exports | ✅ native multi-sheet XLSX and visually verified Arabic management PDF |

## Recently merged delivery pull requests

- PR #23: mandatory CI quality gates and mobile checks
- PR #24: frontend production dependency security upgrade
- PR #25: web/mobile call, SMS and WhatsApp contact actions
- PR #27: backend production dependency security upgrade
- PR #28: Arabic goods-reservations workflow
- PR #29: collection filters and Excel-compatible export

## Remaining before the official v1.3.0 release

- Complete the remaining manual staging checks for reservations, contact actions, read-only access and mobile offline sync.
- Add real Expo/FCM/APNS credentials and perform physical-device Push UAT.
- Configure the real production domain, TLS, secrets, external backup storage and health-monitor URL.
- Update changelog, release notes, versions and tag only after owner approval.
