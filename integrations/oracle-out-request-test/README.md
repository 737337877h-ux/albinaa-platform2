# IAS20191 one-time Oracle out-request write test

This isolated test does not modify or reuse the SELECT-only Oracle Read API.
It accepts only the dedicated `ALBINAAWRITER` account and writes only the
pre-agreed draft request number 2 to `IAS20191`.

Safety gates:

- rejects the exposed password and passwords shorter than 12 characters;
- requires the official UI-created request number 1 to be the only request;
- validates warehouses 1 and 2 and item/unit `00101-01-01` / `حبة`;
- inserts one unapproved, unprocessed master/detail pair in one transaction;
- rolls back both inserts on any failure;
- has no update, delete, execute, or IAS20261 path.

Run `run-secure.ps1` and enter the new writer password in the hidden prompt.
