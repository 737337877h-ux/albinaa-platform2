# AlBinaa Oracle live read-only mirror

Runs the existing guarded customer and inventory snapshot agents every five minutes.

Safety properties:

- Oracle sessions execute `SET TRANSACTION READ ONLY` before fixed `SELECT` queries.
- The Oracle password is encrypted with Windows DPAPI for the current Windows user and machine.
- The plaintext password exists only in process memory and is cleared after each run.
- A named mutex prevents overlapping scheduled runs.
- Unchanged snapshots are not loaded again.
- Only the latest mirror runs are retained in PostgreSQL. Automatic operational publication is disabled until an explicit fingerprint baseline and activation switch are applied.
- When enabled, only post-baseline movements on or after the configured cutoff date are eligible. Historical rows, amount conflicts, unknown customers/items, and invalid rows are quarantined.
- Every automatic batch has an audit record and a non-destructive rollback path. Oracle publication is impossible because the Oracle session remains read-only.
- Oracle is never modified.

Setup:

1. Install the backend dependencies in the Oracle mirror worktree; the loader runs through `ts-node --transpile-only` so it stays isolated from the application server.
2. Run `Initialize-OracleLiveMirrorCredential.ps1` interactively once.
3. Run `Invoke-OracleLiveMirror.ps1` manually and verify the results.
4. Run `Register-OracleLiveMirrorTask.ps1`.

The scheduled task uses an interactive Windows logon token and therefore runs only while the approved Windows user is logged in. This avoids storing the Windows account password.
