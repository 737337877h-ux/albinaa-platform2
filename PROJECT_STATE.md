# Project State — AlBinaa Platform

## Current Status
- **Phase:** Released — v1.0.0 Stable
- **Last Release Tag:** `v1.0.0` (pushed to origin)
- **Last Commit (main):** `dd3809d` — release: v1.0.0 stable - code freeze, cleanup, documentation
- **Date:** 2026-07-30

## Branch Strategy (Git Flow)

| Branch | Purpose | Status |
|--------|---------|--------|
| `main` | Stable releases only (v1.0.0, v1.0.1, v1.1.0, …) | 🔒 Locked — only hotfixes |
| `release/v1.1` | Active development for v1.1 | ✅ Active — feature work |
| `feature/*` | Individual features (branch from `release/v1.1`) | — |
| `hotfix/*` | Urgent fixes for `main` (branch from `main`) | — |

## Workflow

```bash
# 1. Start a new feature (branch from release/v1.1)
git checkout release/v1.1
git pull origin release/v1.1
git checkout -b feature/my-new-feature

# 2. Work, commit, push, open PR → release/v1.1

# 3. When v1.1 is ready → merge release/v1.1 → main, tag v1.1.0
git checkout main
git merge --no-ff release/v1.1
git tag -a v1.1.0 -m "v1.1.0 — ..."
git push origin main --tags

# 4. Urgent hotfix on main
git checkout main
git checkout -b hotfix/critical-fix
# fix → commit → PR → main → tag v1.0.1
```

## Recommended Branch Protection Rules (GitHub)

- `main`: require PR + 1 review + status checks; disallow force-push
- `release/v1.1`: require PR + status checks; allow force-push with lease
- `feature/*`: no protection

## v1.0.0 Snapshot

- **Backend:** `v1.0.0` (NestJS + Prisma + PostgreSQL)
- **Mobile:** `v1.0.0` (React Native + Expo SDK 57)
- **Frontend:** built (Next.js 14)
- **Tests:** 39/39 passing
- **TypeScript:** 0 errors
- **ESLint:** clean
- **Expo Doctor:** 20/20

## v1.1.0 Backlog (planned)

1. Push Notifications (FCM/APNS)
2. Call/SMS/WhatsApp buttons in Customer360
3. Customer location map
4. Dynamic currencies from API
5. iOS support
6. CI/CD pipeline
7. Increase test coverage to 80%
8. APM integration (Sentry)

See [CHANGELOG.md](./CHANGELOG.md) and [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) for full details.
