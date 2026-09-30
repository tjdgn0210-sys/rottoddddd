import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { useGracefulWindowsShutdown } from './helpers/localDatabase.mjs';

// Deliberately starts a fresh loopback cluster: never accepts a remote DB URL.
// Install the test-only runtime as documented in supabase/TESTING.md.
const runtime = createRequire(resolve('.expo/weekly-sql-tests/package.json'));
const { default: EmbeddedPostgres } = await import(pathToFileURL(runtime.resolve('embedded-postgres')).href);

test('weekly initialization on temporary PostgreSQL', async (t) => {
  const server = net.createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  const databaseDir = await mkdtemp(resolve('.expo/weekly-sql-tests/cluster-'));
  assert.ok(databaseDir.startsWith(resolve('.expo/weekly-sql-tests') + (process.platform === 'win32' ? '\\' : '/')));
  const pg = new EmbeddedPostgres({ databaseDir, port, user: 'postgres', password: randomUUID(),
    persistent: true, postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {} });
  const clients = [];
  let started = false;
  async function connect(userId, role = 'authenticated') {
    const client = pg.getPgClient();
    clients.push(client);
    await client.connect();
    if (role) await client.query(`set role ${role}`);
    await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? '']);
    return client;
  }
  try {
    await pg.initialise(); await pg.start(); started = true;
    await useGracefulWindowsShutdown(pg, databaseDir, runtime);
    const admin = await connect(null, null);
    await admin.query(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
    `);
    for (const file of ['20260930000000_weekly_foundation.sql', '20260930010000_ensure_current_week.sql']) {
      await admin.query(await readFile(join('supabase/migrations', file), 'utf8'));
    }
    const userA = randomUUID(), userB = randomUUID(), userC = randomUUID();
    await admin.query('insert into auth.users (id) values ($1), ($2), ($3)', [userA, userB, userC]);
    const a = await connect(userA), b = await connect(userB), anon = await connect(null, 'anon');
    const ensure = async (client) => (await client.query('select public.ensure_current_week() as progress')).rows[0].progress;
    let first, originalSecret;

    await t.test('concurrent authenticated calls create one atomic six-day cycle', async () => {
      const devices = await Promise.all(Array.from({ length: 16 }, () => connect(userA)));
      const results = await Promise.all(devices.map(ensure));
      first = results[0];
      for (const result of results) assert.deepEqual(result, first);
      for (const table of ['public.weekly_cycles', 'private.weekly_secrets']) {
        assert.equal(Number((await admin.query(`select count(*) from ${table} where user_id = $1`, [userA])).rows[0].count), 1);
      }
      const rows = (await admin.query('select day_index,state from public.daily_reveals where user_id=$1 order by day_index', [userA])).rows;
      assert.deepEqual(rows.map((row) => row.day_index), [1, 2, 3, 4, 5, 6]);
      assert.ok(rows.every((row) => row.state === 'WAITING'));
      originalSecret = (await admin.query('select numbers from private.weekly_secrets where user_id=$1', [userA])).rows[0].numbers;
      assert.equal(originalSecret.length, 6); assert.equal(new Set(originalSecret).size, 6);
      assert.ok(originalSecret.every((number) => Number.isInteger(number) && number >= 1 && number <= 45));
    });

    await t.test('RPC returns only whitelisted public metadata', () => {
      assert.deepEqual(Object.keys(first).sort(), ['currentDayIndex', 'reveals', 'submissionStatus', 'submittedAt', 'weekStart']);
      for (const row of first.reveals) assert.deepEqual(Object.keys(row).sort(), ['availableAt', 'consumedAt', 'dayIndex', 'expiresAt', 'state']);
      assert.doesNotMatch(JSON.stringify(first), /numbers|user_id|secret/);
    });

    await t.test('100 repeats preserve secrets and established reveal/submission state', async () => {
      await admin.query("update public.daily_reveals set state='LOCKED', consumed_at=now(), locked_at=now() where user_id=$1 and day_index=1", [userA]);
      await admin.query("update public.weekly_cycles set submission_status='FAILURE', submitted_at=now() where user_id=$1", [userA]);
      const before = await ensure(a);
      for (let i = 0; i < 100; i++) assert.deepEqual(await ensure(a), before);
      assert.equal(before.reveals[0].state, 'LOCKED'); assert.equal(before.submissionStatus, 'FAILURE');
      assert.deepEqual((await admin.query('select numbers from private.weekly_secrets where user_id=$1', [userA])).rows[0].numbers, originalSecret);
      assert.equal(Number((await admin.query('select count(*) from public.daily_reveals where user_id=$1', [userA])).rows[0].count), 6);
    });

    await t.test('unauthenticated callers are denied at grant and identity boundaries', async () => {
      await assert.rejects(ensure(anon), { code: '42501' });
      const noIdentity = await connect(null);
      await assert.rejects(ensure(noIdentity), { code: '28000' });
    });

    await t.test('RLS isolates accounts and no identity/date parameters exist', async () => {
      await ensure(b);
      const rows = (await a.query('select user_id from public.weekly_cycles')).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].user_id, userA);
      assert.equal((await a.query('select * from public.daily_reveals where user_id=$1', [userB])).rows.length, 0);
      await assert.rejects(a.query('select public.ensure_current_week($1::uuid)', [userB]), { code: '42883' });
      await assert.rejects(a.query('select * from private.weekly_secrets'), { code: '42501' });
      await assert.rejects(a.query('update public.user_profiles set point_balance=999'), { code: '42501' });
    });

    await t.test('Seoul Monday boundaries are independent of session timezone; Sunday stays in prior week', async () => {
      for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Seoul']) {
        await admin.query("select set_config('TimeZone', $1, false)", [timezone]);
        const result = (await admin.query(`select
          private.week_start_in_seoul('2026-09-27T14:59:59Z')::text as sunday,
          private.week_start_in_seoul('2026-09-27T15:00:00Z')::text as monday,
          private.week_start_in_seoul('2026-10-04T14:59:59Z')::text as end_week`)).rows[0];
        assert.deepEqual(result, { sunday: '2026-09-21', monday: '2026-09-28', end_week: '2026-09-28' });
      }
      assert.equal((await admin.query('select * from public.daily_reveals where day_index=7')).rows.length, 0);
    });

    await t.test('provisional windows are full local days and profiles use zero defaults', async () => {
      const { rows } = await admin.query(`select day_index,
        (available_at at time zone 'Asia/Seoul')::time::text as starts,
        (expires_at at time zone 'Asia/Seoul')::time::text as ends,
        (available_at at time zone 'Asia/Seoul')::date = week_start + day_index - 1 as correct_day
        from public.daily_reveals where user_id=$1`, [userA]);
      assert.ok(rows.every((row) => row.starts === '00:00:00' && row.ends === '23:59:59.999999' && row.correct_day));
      const profile = (await b.query('select point_balance,current_success_streak,total_successful_weeks from public.user_profiles')).rows[0];
      assert.deepEqual(profile, { point_balance: 0, current_success_streak: 0, total_successful_weeks: 0 });
    });

    await t.test('failure halfway through initialization rolls back all game rows', async () => {
      await admin.query(`create function public.fail_test_reveal() returns trigger language plpgsql as $$
        begin if new.day_index=3 then raise exception 'local test failure'; end if; return new; end $$;
        create trigger fail_test_reveal before insert on public.daily_reveals for each row execute function public.fail_test_reveal();`);
      const c = await connect(userC);
      await assert.rejects(ensure(c), { code: 'P0001' });
      for (const table of ['public.weekly_cycles', 'private.weekly_secrets', 'public.daily_reveals']) {
        assert.equal(Number((await admin.query(`select count(*) from ${table} where user_id=$1`, [userC])).rows[0].count), 0);
      }
      await admin.query('drop trigger fail_test_reveal on public.daily_reveals; drop function public.fail_test_reveal()');
    });

    await t.test('definer search path and grants stay narrow; existing secret immutability holds', async () => {
      const row = (await admin.query(`select prosecdef,proconfig,pronargs from pg_proc where oid='public.ensure_current_week()'::regprocedure`)).rows[0];
      assert.equal(row.prosecdef, true); assert.equal(row.pronargs, 0); assert.deepEqual(row.proconfig, ['search_path=""']);
      for (const role of ['anon', 'service_role']) assert.equal((await admin.query("select has_function_privilege($1,'public.ensure_current_week()','EXECUTE') as allowed", [role])).rows[0].allowed, false);
      await assert.rejects(admin.query('update private.weekly_secrets set numbers=numbers where user_id=$1', [userA]), { code: 'P0001' });
    });

    await t.test('a missing own profile is repaired only with server defaults', async () => {
      await admin.query('delete from public.user_profiles where user_id=$1', [userC]);
      const c = await connect(userC);
      await ensure(c);
      assert.deepEqual((await c.query('select point_balance,current_success_streak,total_successful_weeks from public.user_profiles')).rows,
        [{ point_balance: 0, current_success_streak: 0, total_successful_weeks: 0 }]);
    });
  } finally {
    await Promise.allSettled(clients.map((client) => client.end()));
    if (started) await pg.stop();
    // Windows may briefly retain file handles after PostgreSQL stops.
    await rm(databaseDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
