# GPS Testing Plan — React Native Collector App

**App Version**: 1.1.0
**Last Updated**: 2026-07-29
**Tester**:
**Device**:
**Android Version**:

---

## GPS Configuration (Current)

| Setting | Value | Source |
|---|---|---|
| Foreground interval | 10 000 ms | `GPS_INTERVAL_MS` in `constants.ts` |
| Background interval | 10 000 ms (expo-location default when background) | `constants.ts` |
| Distance interval | 0 meters (time-based) | `gps.ts` |
| Accuracy mode | `Accuracy.High` (GPS + network) | `gps.ts` |
| Batch size | Unbounded per sync cycle | `gps.ts` + `POST /mobile/gps/batch` |
| Upload frequency | Every sync cycle (30s) | `sync-context.tsx` |
| Queue retention | Until uploaded (`synced=0` → `synced=1`) | `database.ts` |
| Max stored points | Unbounded (SQLite) | `database.ts` |
| Deferred time (background) | 0 (immediate) | `gps.ts` |
| Shows background indicator | true (Android notification) | `gps.ts` |

---

## Scenarios

### G1 — Allow Location While Using App
1. Fresh install / clear app data
2. Launch app and log in
3. Navigate to Settings → enable GPS toggle
4. Grant "Allow only while using the app" when prompted

**Expected result**: GPS starts recording. Notification appears. Points stored in `gps_queue`.
**Actual result**:
**Pass/Fail**:

---

### G2 — Allow Location All the Time (Background)
1. From Settings → Apps → Albinaa Collector → Permissions → set Location to "Allow all the time"
2. Launch app, enable GPS
3. Press Home (app goes to background)
4. Walk for 2 minutes
5. Return to app

**Expected result**: GPS points recorded continuously in background. Points visible in queue when app reopens.
**Actual result**:
**Pass/Fail**:

---

### G3 — Deny Location Permission
1. Fresh install
2. When GPS permission prompt appears, tap "Deny"

**Expected result**: GPS toggle stays off. Error message shown: "Location permission is required for GPS tracking". App continues to work without GPS.
**Actual result**:
**Pass/Fail**:

---

### G4 — Revoke Permission After Granting
1. Enable GPS (grant permission)
2. Verify GPS is tracking
3. Go to Android Settings → Apps → Albinaa Collector → Permissions → set Location to "Deny"
4. Return to app

**Expected result**: App detects permission revocation. GPS stops. User notified. GPS toggle resets to off.
**Actual result**:
**Pass/Fail**:

---

### G5 — Device Location Service Turned Off
1. Enable GPS in app
2. Go to Android Settings → Location → turn OFF
3. Return to app

**Expected result**: `expo-location` throws `LOCATION_SERVICES_DISABLED`. App shows alert: "Location services are disabled. Please enable them in Settings." GPS toggle resets.
**Actual result**:
**Pass/Fail**:

---

### G6 — App in Background (Screen Off)
1. Enable GPS
2. Press Power button to turn screen off
3. Wait 2 minutes
4. Unlock and open app

**Expected result**: GPS continued recording in background with screen off. New points in queue.
**Actual result**:
**Pass/Fail**:

---

### G7 — Phone Reboot While GPS Active
1. Enable GPS, verify tracking
2. Reboot phone
3. Open app, log in
4. Enable GPS again

**Expected result**: Previous GPS points preserved in SQLite. GPS restarts after re-enabling. No data loss.
**Actual result**:
**Pass/Fail**:

---

### G8 — Logout While GPS Active
1. Enable GPS, verify tracking
2. Log out from Profile/Settings
3. Log back in

**Expected result**: GPS stops on logout. Unsynced GPS points remain in queue but not uploaded until GPS re-enabled.
**Actual result**:
**Pass/Fail**:

---

### G9 — Internet Disconnect While GPS Active
1. Enable GPS, verify tracking
2. Enable Airplane Mode
3. Walk for 5 minutes
4. Reconnect internet

**Expected result**: GPS points accumulate in queue with `synced=0`. On reconnect, points uploaded in batch. No data loss.
**Actual result**:
**Queue state before reconnect**:
**Queue state after reconnect**:
**Pass/Fail**:

---

### G10 — Upload Accumulated Points After Reconnect
1. Follow G9 (accumulate points offline)
2. Reconnect internet
3. Wait for sync cycle

**Expected result**: All accumulated points uploaded via `POST /mobile/gps/batch`. Queue cleared. Points visible on server.
**Actual result**:
**Queue state**:
**Server record count**:
**Pass/Fail**:

---

### G11 — GPS Not Active for Unauthenticated User
1. Log out completely
2. Try to call any GPS function or enable tracking

**Expected result**: GPS functions behind auth check. No tracking starts. API calls rejected with 401.
**Actual result**:
**Pass/Fail**:

---

### G12 — GPS Entity Linking
1. Create a collection or promise with GPS enabled
2. Verify coordinates attached to the created entity

**Expected result**: GPS coordinates from tracking are linked to the collection/promise on the server.
**Actual result**:
**Pass/Fail**:

---

### G13 — Battery Impact (≥1 hour)
1. Fully charge phone
2. Enable GPS tracking in app
3. Use app normally + background tracking
4. Measure battery drain after 1 hour
5. Compare with baseline (1 hour with GPS off)

**Expected result**: Battery drain with GPS ≤ 15% per hour (acceptable range for field work).
**Actual result**:
**Battery with GPS off (1h)**:
**Battery with GPS on (1h)**:
**Delta (%/hour)**:
**Pass/Fail**:

---

## Summary

| Scenario | Pass/Fail | Notes |
|---|---|---|
| G1 — Allow while using | | |
| G2 — Allow all the time | | |
| G3 — Deny permission | | |
| G4 — Revoke permission | | |
| G5 — Location service off | | |
| G6 — Screen off | | |
| G7 — Phone reboot | | |
| G8 — Logout during tracking | | |
| G9 — Offline accumulation | | |
| G10 — Upload after reconnect | | |
| G11 — Not for unauth user | | |
| G12 — Entity linking | | |
| G13 — Battery impact | | |
