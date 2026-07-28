# Offline Testing Plan — React Native Collector App

**App Version**: 1.1.0
**Last Updated**: 2026-07-29
**Tester**:
**Device**:
**Android Version**:

---

## Baseline Scenarios

### Scenario 1 — Login with Internet
1. Launch app with internet ON
2. Enter credentials
3. Verify dashboard loads with synced data

**Expected result**: Login succeeds, syncToken stored, SQLite populated
**Actual result**:
**Pass/Fail**:

---

### Scenario 2 — Initial Sync
1. After login, verify sync completes
2. Open Customers, verify list populated from server

**Expected result**: Customers, tasks, followups, promises, collections synced to SQLite
**Actual result**:
**Pass/Fail**:

---

### Scenario 3 — Go Offline
1. Enable Airplane Mode
2. Navigate through app

**Expected result**: App still renders cached data, no crash
**Actual result**:
**Pass/Fail**:

---

### Scenario 4 — Create Follow-up Offline
1. While offline, select a customer
2. Tap "New Follow-up"
3. Enter notes, select type
4. Submit

**Expected result**: Follow-up saved to mutation_queue with status `pending`
**Actual result**:
**Queue state**:
**Pass/Fail**:

---

### Scenario 5 — Create Promise Offline
1. While offline, select a customer
2. Tap "New Promise"
3. Enter amount and currency
4. Submit

**Expected result**: Promise saved to mutation_queue with status `pending`
**Actual result**:
**Queue state**:
**Pass/Fail**:

---

### Scenario 6 — Create Collection Offline
1. While offline, select a customer
2. Tap "New Collection"
3. Enter amount, currency, payment method
4. Submit

**Expected result**: Collection saved to mutation_queue with status `pending`
**Actual result**:
**Queue state**:
**Pass/Fail**:

---

### Scenario 7 — Capture Receipt Offline
1. While offline, go to Upload Receipt
2. Take a photo or select from gallery
3. Submit

**Expected result**: Receipt queued with `receipt_uri` pointing to local file; linked to the collection if applicable
**Actual result**:
**Queue state**:
**Pass/Fail**:

---

### Scenario 8 — Force Close App Offline
1. With items in mutation_queue (from S4–S7)
2. Force close app (swipe from recents)
3. Re-open app while still offline

**Expected result**: App rehydrates from SQLite, mutation_queue items persist
**Actual result**:
**Pass/Fail**:

---

### Scenario 9 — Open App Offline (No Pre-existing Queue)
1. Clear app data or fresh install
2. Open app with no internet
3. Try to log in

**Expected result**: Login fails gracefully with "No internet connection" message
**Actual result**:
**Pass/Fail**:

---

### Scenario 10 — Verify Queue Persistence
1. After S8, navigate to Customer 360 (offline)
2. Verify the data created in S4–S7 appears in customer timeline as local-only entries (if implemented) or is marked as pending

**Expected result**: Queue entries visible and marked as pending in UI
**Actual result**:
**Queue state**:
**Pass/Fail**:

---

### Scenario 11 — Reconnect Internet
1. Turn off Airplane Mode
2. Wait for sync cycle (up to 30s)

**Expected result**: Mutation queue items processed, `Idempotency-Key` headers included
**Actual result**:
**Pass/Fail**:

---

### Scenario 12 — Verify Each Operation Sent Once
1. After S11, check server database
2. Query `/followups`, `/payment-promises`, `/collections` for the records created offline

**Expected result**: Each operation stored exactly once on server
**Actual result**:
**Server record count**:
**Pass/Fail**:

---

### Scenario 13 — Verify No Duplicate Collection
1. After S11, check server: duplicate collection must not exist even if the request was replayed

**Expected result**: Server rejected duplicate via idempotency key
**Actual result**:
**Server record count**:
**Pass/Fail**:

---

### Scenario 14 — Receipt Upload After Collection Sync
1. After collection syncs, verify the linked receipt (if any) was uploaded
2. Check server for receipt associated with the collection

**Expected result**: Receipt uploaded successfully; linked to collection
**Actual result**:
**Server record count**:
**Pass/Fail**:

---

### Scenario 15 — Queue Clears After Server Confirmation
1. After S11, inspect local mutation_queue
2. Open Settings or use dev tooling to verify queue is empty

**Expected result**: All processed items removed from mutation_queue
**Actual result**:
**Queue state**:
**Pass/Fail**:

---

## Failure Mode Scenarios

### F1 — Network Timeout
1. With internet ON, make server unresponsive (stop docker backend or use proxy to delay >30s)
2. Submit a collection

**Expected result**: Request fails with timeout. Retry with exponential backoff begins.
**Actual result**:
**Queue state**: mutation remains with `retryCount` incremented
**Retry count**:
**Server record count**: 0
**Pass/Fail**:

---

### F2 — HTTP 500 Internal Server Error
1. Trigger server error (e.g. malformed payload)
2. Submit mutation

**Expected result**: 500 response, mutation stays in queue with `retryCount++`, `lastError = '500'`
**Actual result**:
**Queue state**:
**Retry count**:
**Server record count**: 0
**Pass/Fail**:

---

### F3 — HTTP 429 Rate Limited
1. Send rapid requests to trigger rate limiting
2. Submit mutation

**Expected result**: 429 response, mutation stays in queue with `retryCount++`, respects `Retry-After` header if present
**Actual result**:
**Queue state**:
**Retry count**:
**Server record count**: 0
**Pass/Fail**:

---

### F4 — Access Token Expired
1. Wait for token to expire (or short-circuit expiry on dev)
2. Submit mutation while token is expired

**Expected result**: Axios 401 interceptor attempts refresh; if refresh succeeds, original request retried with new token
**Actual result**:
**Queue state**:
**Retry count**:
**Server record count**:
**Pass/Fail**:

---

### F5 — Refresh Token Failed
1. Corrupt or expire the refresh token
2. Submit mutation

**Expected result**: Refresh fails (401), user logged out, mutation removed from queue
**Actual result**:
**Queue state**: Cleared
**Retry count**: N/A
**Server record count**: 0
**Pass/Fail**:

---

### F6 — Network Cut During Request
1. Submit a mutation (e.g. collection)
2. Cut network mid-request (enable airplane mode during axios call)

**Expected result**: Axios throws network error. Mutation stays in queue with `retryCount++`
**Actual result**:
**Queue state**:
**Retry count**:
**Server record count**: 0 (or 1 if server received it — idempotency key prevents duplicate)
**Pass/Fail**:

---

### F7 — Collection Succeeds But Receipt Upload Fails
1. Create collection offline
2. Attach receipt
3. Reconnect
4. Collection syncs, but receipt upload fails (e.g. 500 from server)

**Expected result**: Collection created on server. Receipt remains in queue for retry. Collection's `receipt_url` remains null until receipt uploads.
**Actual result**:
**Queue state**:
**Retry count**:
**Server record count**: Collection = 1, Receipt = 0
**Pass/Fail**:

---

### F8 — App Closed During Sync
1. Have items in mutation queue
2. Sync starts
3. Force close app while sync is in progress

**Expected result**: On next open, queue items still present. Idempotency key prevents duplicates on server.
**Actual result**:
**Queue state**:
**Retry count**:
**Server record count**:
**Pass/Fail**:

---

### F9 — Resend Same operationId
1. Manually send a request with a previously used `Idempotency-Key`
2. Submit to same endpoint with same payload

**Expected result**: Server returns cached 201 response from first request. No duplicate created.
**Actual result**:
**Queue state**: N/A
**Retry count**: N/A
**Server record count**: 1 (still one record, not two)
**Pass/Fail**:

---

### F10 — GPS Queue Accumulates While Offline
1. Enable GPS tracking
2. Go offline for 10+ minutes
3. Verify GPS points accumulate in `gps_queue`

**Expected result**: GPS points stored with `synced=0`; no data loss
**Actual result**:
**Queue state**:
**Server record count**:
**Pass/Fail**:

---

## Summary

| Scenario | Pass/Fail | Notes |
|---|---|---|
| S1 — Login with internet | | |
| S2 — Initial sync | | |
| S3 — Go offline | | |
| S4 — Follow-up offline | | |
| S5 — Promise offline | | |
| S6 — Collection offline | | |
| S7 — Receipt offline | | |
| S8 — Force close offline | | |
| S9 — Open app offline | | |
| S10 — Queue persistence | | |
| S11 — Reconnect | | |
| S12 — No duplicate ops | | |
| S13 — No duplicate collection | | |
| S14 — Receipt after collection | | |
| S15 — Queue clears | | |
| F1 — Timeout | | |
| F2 — HTTP 500 | | |
| F3 — HTTP 429 | | |
| F4 — Token expired | | |
| F5 — Refresh failure | | |
| F6 — Network mid-request | | |
| F7 — Collection OK, receipt fail | | |
| F8 — App closed during sync | | |
| F9 — Same operationId | | |
| F10 — GPS offline accumulation | | |
