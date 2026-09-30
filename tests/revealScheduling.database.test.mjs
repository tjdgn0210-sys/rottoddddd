import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withLocalDatabase } from './helpers/localDatabase.mjs';

test('private scheduling, server boundaries, and one-time consumption', async (t) => withLocalDatabase(async ({ admin,connect,apply }) => {
  await apply('20260930000000_weekly_foundation.sql');
  await apply('20260930010000_ensure_current_week.sql');
  const legacyUser = randomUUID();
  await admin.query('insert into auth.users values($1)',[legacyUser]);
  const legacy = await connect(legacyUser,'authenticated');
  const old = (await legacy.query('select public.ensure_current_week() as p')).rows[0].p;
  await admin.query("update public.daily_reveals set state='LOCKED',consumed_at=now(),locked_at=now() where user_id=$1 and day_index=1",[legacyUser]);
  const oldSecret = (await admin.query('select numbers from private.weekly_secrets where user_id=$1',[legacyUser])).rows[0].numbers;
  await apply('20260930020000_private_reveal_scheduling.sql');
  await apply('20260930021000_explicit_schedule_arrays.sql');
  // Trusted local-only clock substitution. Production's private.server_now()
  // accepts no arguments and always calls the real database clock.
  await admin.query(`create or replace function private.server_now() returns timestamptz language sql volatile set search_path='' as
    $$ select current_setting('test.now')::timestamptz $$;`);
  const setTime = (client, now) => client.query("select set_config('test.now',$1,false)",[now]);
  const ensure = async (client) => (await client.query('select public.ensure_current_week() as p')).rows[0].p;
  const status = async (client) => (await client.query('select public.get_current_reveal_status() as p')).rows[0].p;
  const consume = async (client) => (await client.query('select public.consume_daily_reveal() as n')).rows[0].n;
  const newUser = async () => { const id=randomUUID();await admin.query('insert into auth.users values($1)',[id]);return {id,client:await connect(id,'authenticated')}; };
  const fixtures = async (id,day=1) => (await admin.query(`select r.public_window_start,r.public_window_end,
    s.exact_available_at,s.exact_expires_at from public.daily_reveals r join private.daily_reveal_schedules s using(user_id,week_start,day_index)
    where user_id=$1 and week_start='2026-09-28' and day_index=$2`,[id,day])).rows[0];
  const iso = (date,offset=0) => new Date(new Date(date).getTime()+offset).toISOString();
  let a, initial, schedules;

  await t.test('migration preserves provisional timings, secret numbers, and consumed state',async () => {
    const rows=(await admin.query('select * from private.daily_reveal_schedules where user_id=$1 order by day_index',[legacyUser])).rows;
    assert.equal(rows.length,6);
    for(const [i,row] of rows.entries()) {assert.equal(row.schedule_kind,'LEGACY');assert.equal(iso(row.exact_available_at),iso(old.reveals[i].availableAt));assert.equal(iso(row.exact_expires_at),iso(old.reveals[i].expiresAt));}
    assert.deepEqual((await admin.query('select numbers from private.weekly_secrets where user_id=$1',[legacyUser])).rows[0].numbers,oldSecret);
    assert.equal((await admin.query('select state from public.daily_reveals where user_id=$1 and day_index=1',[legacyUser])).rows[0].state,'LOCKED');
  });
  await t.test('concurrent initialization creates six stable public/private schedules with five-minute expiry',async () => {
    a=await newUser();const devices=await Promise.all(Array.from({length:12},()=>connect(a.id,'authenticated')));
    const results=await Promise.all(devices.map(ensure));initial=results[0];results.forEach((r)=>assert.deepEqual(r,initial));
    schedules=(await admin.query('select * from private.daily_reveal_schedules where user_id=$1 order by day_index',[a.id])).rows;
    assert.equal(schedules.length,6);
    for(let i=0;i<6;i++) {const s=schedules[i],r=initial.reveals[i];assert.equal(s.schedule_kind,'FINAL');assert.equal(new Date(s.exact_expires_at)-new Date(s.exact_available_at),300000);assert.ok(new Date(s.exact_available_at)>=new Date(r.publicWindowStart));assert.ok(new Date(s.exact_available_at)<new Date(r.publicWindowEnd));assert.equal(r.state,'WAITING');}
    for(let i=0;i<100;i++) assert.deepEqual(await ensure(a.client),initial);
    assert.deepEqual((await admin.query('select * from private.daily_reveal_schedules where user_id=$1 order by day_index',[a.id])).rows,schedules);
  });
  await t.test('weekday windows are allowed four-hour ranges; Saturday is 17:00–19:30 only',async () => {
    // Many new cycles exercise independent backend window selection.
    for(let i=0;i<12;i++) {const u=await newUser();await ensure(u.client);}
    const rows=(await admin.query(`select day_index,(public_window_start at time zone 'Asia/Seoul')::time::text as start,
      (public_window_end at time zone 'Asia/Seoul')::time::text as finish,
      extract(epoch from public_window_end-public_window_start)::int as seconds
      from public.daily_reveals where user_id<>$1`,[legacyUser])).rows;
    for(const r of rows) if(r.day_index===6) assert.deepEqual([r.start,r.finish,r.seconds],['17:00:00','19:30:00',9000]);
      else {assert.ok(['09:00:00','13:00:00','17:00:00'].includes(r.start));assert.equal(r.seconds,14400);}
  });
  await t.test('client table queries and both RPCs contain no exact schedule or weekly numbers',async () => {
    const rows=(await a.client.query('select * from public.daily_reveals')).rows;
    assert.equal(rows.length,6);
    for(const row of rows) assert.ok(!('available_at' in row)&&!('expires_at' in row)&&!('exact_available_at' in row));
    for(const value of [await ensure(a.client),await status(a.client),rows]) assert.doesNotMatch(JSON.stringify(value),/exact_|availableAt|expiresAt|numbers/);
    const waiting=await status(a.client);assert.equal(waiting.reveal.state,'WAITING');assert.equal(waiting.remainingSeconds,null);
  });
  await t.test('private tables/helpers inaccessible; schedules and public windows cannot be changed',async () => {
    for(const table of ['private.daily_reveal_schedules','private.weekly_secrets']) await assert.rejects(a.client.query(`select * from ${table}`),{code:'42501'});
    await assert.rejects(a.client.query("update public.daily_reveals set public_window_start=now()"),{code:'42501'});
    await assert.rejects(admin.query('update private.daily_reveal_schedules set exact_expires_at=exact_expires_at+interval \'1 minute\' where user_id=$1',[a.id]),{code:'P0001'});
    await assert.rejects(admin.query('update public.daily_reveals set public_window_end=public_window_end+interval \'1 minute\' where user_id=$1',[a.id]),{code:'P0001'});
    await assert.rejects(a.client.query('select private.server_now()'),{code:'42501'});
    await assert.rejects(a.client.query("select public.get_current_reveal_status($1::uuid)",[legacyUser]),{code:'42883'});
    assert.equal((await a.client.query('select * from public.daily_reveals where user_id=$1',[legacyUser])).rows.length,0);
  });
  await t.test('opening is inclusive, expiry exclusive, expired remains terminal',async () => {
    const u=await newUser();await ensure(u.client);const s=await fixtures(u.id);
    await setTime(u.client,iso(s.exact_available_at,-1000));assert.equal((await status(u.client)).reveal.state,'WAITING');await assert.rejects(consume(u.client),{code:'P0001'});
    await setTime(u.client,iso(s.exact_available_at));let p=await status(u.client);assert.equal(p.reveal.state,'AVAILABLE');assert.equal(p.remainingSeconds,300);
    await setTime(u.client,iso(s.exact_expires_at,-1000));p=await status(u.client);assert.equal(p.reveal.state,'AVAILABLE');assert.equal(p.remainingSeconds,1);
    await setTime(u.client,iso(s.exact_expires_at));assert.equal(await consume(u.client),null);p=await status(u.client);assert.equal(p.reveal.state,'EXPIRED');assert.equal(p.remainingSeconds,null);
    await setTime(u.client,iso(s.exact_available_at));assert.equal(await consume(u.client),null);assert.equal((await status(u.client)).reveal.state,'EXPIRED');
  });
  await t.test('multiple concurrent consumes/status/initialization return exactly one daily number',async () => {
    const u=await newUser();await ensure(u.client);const s=await fixtures(u.id);
    const devices=await Promise.all(Array.from({length:16},()=>connect(u.id,'authenticated',iso(s.exact_available_at))));
    const outcomes=await Promise.allSettled([...devices.slice(0,8).map(consume),...devices.slice(8,12).map(status),...devices.slice(12).map(ensure)]);
    const winners=outcomes.slice(0,8).filter((r)=>r.status==='fulfilled');assert.equal(winners.length,1);assert.ok(Number.isInteger(winners[0].value));
    const secret=(await admin.query('select numbers from private.weekly_secrets where user_id=$1',[u.id])).rows[0].numbers;assert.equal(winners[0].value,secret[0]);
    const fresh=await connect(u.id,'authenticated',iso(s.exact_available_at));assert.equal((await status(fresh)).reveal.state,'LOCKED');await assert.rejects(consume(fresh),{code:'P0001'});
  });
  await t.test('precise Seoul boundaries and Sunday never create a seventh reveal',async () => {
    for(const time of ['08:59:59','09:00:00','12:59:59','13:00:00','16:59:59','17:00:00','20:59:59']) {
      const now=`2026-09-28T${time}+09:00`;
      const row=(await admin.query(`select private.effective_reveal_state('WAITING',null,$1::timestamptz,'2026-09-28T13:00:00+09:00','2026-09-28T13:05:00+09:00') as state`,[now])).rows[0];
      assert.equal(row.state,time<'13:00:00'?'WAITING':time<'13:05:00'?'AVAILABLE':'EXPIRED');
    }
    for(const time of ['16:59:59','17:00:00','19:29:59','19:30:00']) {
      const row=(await admin.query(`select private.effective_reveal_state('WAITING',null,$1::timestamptz,'2026-10-03T19:29:59+09:00','2026-10-03T19:34:59+09:00') as state`,[`2026-10-03T${time}+09:00`])).rows[0];
      assert.equal(row.state,time<'19:29:59'?'WAITING':'AVAILABLE');
    }
    const sunday=await newUser();await setTime(sunday.client,'2026-10-04T00:00:00+09:00');const p=await status(sunday.client);assert.equal(p.weekStart,'2026-09-28');assert.equal(p.currentDayIndex,null);assert.equal(p.reveal,null);await assert.rejects(consume(sunday.client),{code:'P0001'});
    await setTime(sunday.client,'2026-10-05T00:00:00+09:00');assert.equal((await status(sunday.client)).weekStart,'2026-10-05');
    assert.equal((await admin.query('select * from public.daily_reveals where day_index=7')).rows.length,0);
  });
  await t.test('all production APIs are zero-argument, narrow-granted, and unauthenticated calls fail',async () => {
    const anon=await connect(null,'anon'),noUser=await connect(null,'authenticated');
    for(const fn of ['ensure_current_week','get_current_reveal_status','consume_daily_reveal']) {
      await assert.rejects(anon.query(`select public.${fn}()`),{code:'42501'});await assert.rejects(noUser.query(`select public.${fn}()`),{code:'28000'});
      const row=(await admin.query(`select pronargs,prosecdef,proconfig from pg_proc where oid=$1::regprocedure`,[`public.${fn}()`])).rows[0];assert.equal(row.pronargs,0);assert.equal(row.prosecdef,true);assert.deepEqual(row.proconfig,['search_path=""']);
    }
  });
}));
