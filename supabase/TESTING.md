# Weekly initialization verification

The focused database test boots an isolated, loopback-only PostgreSQL 17 cluster,
applies both actual migrations, supplies a minimal local Auth schema, and simulates
JWT identities through PostgreSQL session settings. It never reads `.env`, accepts
a remote database URL, or writes test accounts to the linked Supabase project.

Install the temporary test runtime (no application dependency changes):

```powershell
npm install --prefix .expo/weekly-sql-tests --cache .expo/npm-cache --no-audit --no-fund embedded-postgres@17.10.0-beta.17
pnpm test:database
```

The ignored `.expo` directory holds downloaded binaries and temporary data.
The test stops PostgreSQL and removes its temporary cluster after execution.
It verifies concurrent creation, 100 repeat calls, rollback, safe metadata,
RLS/account isolation, grants, profile defaults, and Seoul week boundaries.
These tests validate database behavior; they do not verify real Supabase Auth
sign-up, confirmation-email delivery, or authenticated app sessions.

New weeks use provisional Monday–Saturday windows from 00:00 Seoul until the
last microsecond of the same day, matching the existing private creator's
same-day validation. Sunday has no seventh slot. Every slot starts `WAITING`;
the existing reveal RPC checks the clock and advances its state. Re-initializing
an existing week preserves its secret, windows, reveals, and submission result.
Random windows and the final scheduler are intentionally deferred.
