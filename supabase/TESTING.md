# Weekly initialization verification

The focused database test boots an isolated, loopback-only PostgreSQL 17 cluster,
applies the actual migrations, supplies a minimal local Auth schema, and simulates
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

The original initialization test still validates the first two migrations and
their provisional behavior. The scheduling test applies both scheduling migrations,
verifies preservation of legacy rows, and tests the current final scheduling
rules. Its trusted local fixture replaces the private no-argument clock helper
to exercise exact boundaries; production always uses the database clock.

New Monday–Friday schedules select one of 09:00–13:00, 13:00–17:00, or
17:00–21:00 in Asia/Seoul. Saturday uses 17:00–19:30. Exact availability uses
a random whole-second offset with inclusive start and exclusive public end;
expiry is exactly five minutes later, even if it extends beyond the public
window. Sunday has no seventh slot. Exact times live only in the private schema.

Status and initialization RPCs synchronize effective states lazily, without cron.
Only AVAILABLE status returns remaining seconds. Consumption is profile/row
locked, returns one number once, and commits EXPIRED with a null response after
the cutoff. Re-initialization never changes schedules, numbers, or terminal state.

The pre-migration remote inspection on 2026-09-30 found zero cycles/reveals.
The migration nevertheless preserves any legacy schedule and consumed state
verbatim in private storage; full-day legacy opportunities are grandfathered,
not silently shortened or randomized. Only new cycles use the five-minute rule.
No remote test account or game state is created by these tests.

Client status refreshes on screen focus, app resume, and every 15 seconds while
active; manual refresh is also available. That polling does not authorize a reveal:
the consume RPC checks the clock again after acquiring its lock.
