# Milestone 8 — React Native Collector App (Delivery Report)

**Commit**: TBD
**Branch**: `main`
**Platform**: Expo SDK 57 (Managed Workflow) + TypeScript

---

## Choice: Expo Managed Workflow

| Criteria | Expo | RN CLI |
|---|---|---|
| Build complexity | ✅ Low (`expo build`) | ❌ Medium (Android Studio) |
| Camera/GPS/SecureStore | ✅ Built-in via expo-* | ✅ Also supported |
| OTA Updates | ✅ Yes | ❌ No |
| Development speed | ✅ Faster | ❌ Slower |
| Native module access | ⚠️ Dev client if needed | ✅ Full access |
| Bundle size | ⚠️ Slightly larger | ✅ Smaller |

**Decision**: Expo managed workflow — all required native modules are supported, development is faster, and OTA updates simplify deployment.

---

## Screens Implemented (13 screens)

| # | Screen | File | Features |
|---|---|---|---|
| 1 | **Login** | `src/screens/login.tsx` | JWT auth, SecureStore, Arabic UI |
| 2 | **Dashboard** | `src/screens/dashboard.tsx` | Cards (tasks, collections, customers, followups), last 5 today tasks, logout |
| 3 | **Today's Tasks** | `src/screens/tasks.tsx` | Pull-to-refresh, FlatList, navigate to Customer 360 |
| 4 | **Customers** | `src/screens/customers.tsx` | Search bar, offline data from SQLite, navigate to 360 |
| 5 | **Customer 360** | `src/screens/customer-360.tsx` | Balances, timeline, action buttons (followup/promise/collection) |
| 6 | **New Follow-up** | `src/screens/new-followup.tsx` | Type selection (visit/call/message), notes, offline queue |
| 7 | **New Promise** | `src/screens/new-promise.tsx` | Amount, currency (SAR/USD/AED), GPS auto-attach, offline queue |
| 8 | **New Collection** | `src/screens/new-collection.tsx` | Amount, currency, payment methods (cash/transfer/check/POS), GPS, offline queue, prompt to upload receipt |
| 9 | **Upload Receipt** | `src/screens/upload-receipt.tsx` | Camera capture, gallery pick, image compression (1920px, 0.7 quality), upload via FormData |
| 10 | **GPS Tracking** | `src/utils/gps.ts` | Foreground + background, 10s interval, queued to SQLite, batched upload |
| 11 | **Notifications** | `src/screens/notifications.tsx` | List with read/unread, mark all read |
| 12 | **Profile** | `src/screens/profile.tsx` | Avatar, name, roles, permissions count, version |
| 13 | **Settings** | `src/screens/settings.tsx` | GPS toggle (with permission request), background sync toggle, logout |

---

## Navigation

```
RootNavigator (Stack)
├── Login (unauthorized)
└── Main (authorized — Tab Navigator)
│   ├── Dashboard (Tab)
│   ├── Tasks (Tab)
│   ├── Customers (Tab)
│   ├── Notifications (Tab)
│   └── Profile (Tab)
├── Customer360 (Stack)
├── NewFollowup (Stack)
├── NewPromise (Stack)
├── NewCollection (Stack)
├── UploadReceipt (Stack)
└── Settings (Stack)
```

---

## Offline Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    React Native App                       │
├─────────────────────────────────────────────────────────┤
│  TanStack Query (cache + background refetch every 30s)   │
│         │                                        │        │
│         ▼                                        ▼        │
│  ┌─────────────┐                     ┌──────────────┐    │
│  │  SQLite DB   │                     │ Mutation Queue│    │
│  │  (albinaa.db)│                     │ (idempotent)  │    │
│  │             │                     │              │    │
│  │ • customers │                     │ • operationId │    │
│  │ • tasks     │◄── sync ──────────► │ • endpoint    │    │
│  │ • followups │                     │ • payload     │    │
│  │ • promises  │                     │ • retryCount  │    │
│  │ • collections│                    │ • lastError   │    │
│  └─────────────┘                     └──────┬───────┘    │
│         ▲                                   │            │
│         │                                   ▼            │
│  ┌──────┴──────┐                  ┌─────────────────┐    │
│  │  GPS Queue  │                  │  Axios Client    │    │
│  │  (synced=0) │────► batch ────► │  + JWT interceptor│    │
│  └─────────────┘                  └─────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Sync Data Flow

```
Mobile → POST /mobile/sync {lastSyncToken?}
       ← 200 {syncToken, tasks, customers, followups, promises, collections}
         → store in SQLite, save syncToken for next sync
         → automatic every 30s (SyncProvider)
         → also on app foreground (AppState listener)
```

### Offline Mutations

```
1. User creates a collection while offline
2. Data saved to SQLite mutation_queue with UUID operationId
3. When online: queue processed sequentially
4. On success: removed from queue
5. On failure: retryCount incremented; dropped after 3 retries
```

---

## GPS Tracking

| Aspect | Detail |
|---|---|
| Permission | Foreground + Background (expo-location) |
| Interval | 10 seconds / 10 meters |
| Storage | SQLite `gps_queue` table (unsynced = 0) |
| Upload | Batched via `POST /mobile/gps/batch` |
| Frequency | Every sync cycle (30s) |

---

## Camera & Image Upload

| Aspect | Detail |
|---|---|
| Source | Camera or Gallery (expo-image-picker) |
| Compression | Resize to 1920px width, JPEG quality 0.7 (expo-image-manipulator) |
| Upload | FormData via `POST /mobile/upload-receipt` |
| Max size | 10 MB (server-enforced) |
| Types | jpeg, png, gif, webp, pdf (server-whitelisted) |

---

## Security

| Aspect | Detail |
|---|---|
| JWT Storage | SecureStore (encrypted) |
| Token Refresh | Automatic via Axios 401 interceptor |
| Session End | Clear SecureStore on logout/refresh failure |
| Certificate Pinning | ❌ Not yet implemented (documented for future) |

---

## Dependencies

| Package | Purpose |
|---|---|
| `@react-navigation/native` + `native-stack` + `bottom-tabs` | Navigation |
| `@tanstack/react-query` | Server state management + cache |
| `axios` | HTTP client with JWT interceptor |
| `zod` + `react-hook-form` + `@hookform/resolvers` | Form validation |
| `expo-secure-store` | Secure JWT storage |
| `expo-sqlite` | Local SQLite database |
| `expo-location` | GPS foreground + background |
| `expo-image-picker` | Camera + gallery |
| `expo-image-manipulator` | Image compression |
| `expo-notifications` | Push notifications |
| `expo-task-manager` + `expo-background-fetch` | Background tasks |

---

## Quality Checks

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | **0 errors** ✅ |
| ESLint (`eslint src/ App.tsx`) | **0 errors, 0 warnings** ✅ |
| Build (expo export) | Pending (requires Android SDK or EAS) |

---

## How to Run

```bash
# Development
cd mobile
npx expo start

# Android build
npx expo run:android

# Production build (EAS)
npx eas build --platform android
```

---

## API Integration Points

All API calls go to the existing NestJS backend at `API_BASE_URL`:
- Auth: `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`
- Sync: `/mobile/sync`
- GPS: `/mobile/gps`, `/mobile/gps/batch`
- Upload: `/mobile/upload-receipt`
- Tasks: `/tasks/today`
- Customers: `/mobile/customers`, `/mobile/customers/:id`
- Followups: `/followups`
- Promises: `/promises`
- Collections: `/collections`
- Notifications: `/notifications`

---

## File Structure

```
mobile/
├── App.tsx                          # Entry point with providers
├── eslint.config.mjs                # ESLint flat config
├── src/
│   ├── api/
│   │   ├── client.ts                # Axios + JWT interceptor + refresh
│   │   ├── auth.ts                  # Login, logout, token management
│   │   └── endpoints.ts             # All API functions
│   ├── db/
│   │   └── database.ts              # SQLite schema, CRUD, queues
│   ├── store/
│   │   ├── auth-context.tsx         # Auth state + SecureStore
│   │   └── sync-context.tsx         # Background sync engine
│   ├── navigation/
│   │   └── root-navigator.tsx       # Stack + Tab navigation
│   ├── screens/
│   │   ├── login.tsx                # Login screen
│   │   ├── dashboard.tsx            # Dashboard with summary cards
│   │   ├── tasks.tsx                # Today's tasks
│   │   ├── customers.tsx            # Customer list with search
│   │   ├── customer-360.tsx         # Customer detail + timeline
│   │   ├── new-followup.tsx         # Create follow-up
│   │   ├── new-promise.tsx          # Create payment promise
│   │   ├── new-collection.tsx       # Create collection
│   │   ├── upload-receipt.tsx       # Camera/gallery + upload
│   │   ├── notifications.tsx        # Notification list
│   │   ├── profile.tsx              # User profile
│   │   └── settings.tsx             # GPS, sync, logout
│   ├── components/
│   │   └── loading.tsx              # Loading indicator
│   └── utils/
│       ├── constants.ts             # App constants
│       ├── gps.ts                   # GPS tracking utils
│       └── image.ts                 # Camera/gallery + compression
├── app.json
├── package.json
└── tsconfig.json
```

---

## Next Steps (Post-M8)

1. **Certificate Pinning** — Add for production security
2. **Push Notifications** — Integrate FCM via expo-notifications
3. **E2E Tests** — Detox or Maestro for mobile E2E
4. **App Store Submission** — EAS Build + screenshots + metadata
5. **Background GPS Task** — Register with expo-task-manager for reliable background collection
