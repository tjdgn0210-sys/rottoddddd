import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withLocalDatabase } from './helpers/localDatabase.mjs';

test('protected push devices and idempotent due notification delivery', async(t)=>withLocalDatabase(async({admin,connect,apply})=>{
  for(const file of ['20260930000000_weekly_foundation.sql','20260930010000_ensure_current_week.sql',
    '20260930020000_private_reveal_scheduling.sql','20260930021000_explicit_schedule_arrays.sql',
    '20260930030000_reveal_push_devices.sql','20260930031000_reveal_push_scheduler.sql']) await apply(file);
  await admin.query(`create or replace function private.server_now() returns timestamptz language sql volatile set search_path='' as
    $$ select current_setting('test.now')::timestamptz $$;`);
  const now=(client,value)=>client.query("select set_config('test.now',$1,false)",[new Date(value).toISOString()]);
  const ids=[randomUUID(),randomUUID()]; await admin.query('insert into auth.users values($1),($2)',ids);
  const [a,b,worker,anon,noUser]=await Promise.all([connect(ids[0],'authenticated'),connect(ids[1],'authenticated'),connect(null,'service_role'),connect(null,'anon'),connect(null,'authenticated')]);
  const tokens=['ExpoPushToken[synthetic_device_one]','ExpoPushToken[synthetic_device_two]'];
  const installs=[randomUUID(),randomUUID()];
  const register=(client,token=tokens[0],installation=installs[0])=>client.query('select public.register_push_device($1,\'android\',$2)',[token,installation]);
  const claims=async()=> (await worker.query('select * from public.claim_due_reveal_pushes()')).rows;
  const prepare=async(id)=> (await worker.query('select * from public.prepare_reveal_push($1)',[id])).rows;
  const finish=(id,outcome,ticket=null,error=null)=>worker.query('select public.finish_reveal_push($1,$2,$3,$4)',[id,outcome,ticket,error]);
  let schedule,claimed;
  await t.test('registration requires auth, validates input, and exposes no device table',async()=>{
    await assert.rejects(register(anon),{code:'42501'});await assert.rejects(register(noUser),{code:'28000'});
    await assert.rejects(register(a,'invalid'),{code:'22023'});
    await assert.rejects(a.query('select public.register_push_device($1,\'android\',$2,$3)',[tokens[0],installs[0],ids[1]]),{code:'42883'});
    await register(a);await register(a);await register(a,tokens[1],installs[1]);
    assert.equal((await admin.query('select * from public.push_devices')).rows.length,2);
    for(const client of [a,b,anon]) await assert.rejects(client.query('select * from public.push_devices'),{code:'42501'});
    await assert.rejects(a.query('select * from private.reveal_push_deliveries'),{code:'42501'});
    await assert.rejects(a.query('select public.claim_due_reveal_pushes()'),{code:'42501'});
  });
  await t.test('disable is owner-scoped; token transfer and replacement preserve multiple devices',async()=>{
    await b.query('select public.unregister_push_device($1)',[tokens[0]]);
    assert.equal((await a.query('select public.get_push_device_status($1) as enabled',[tokens[0]])).rows[0].enabled,true);
    await a.query('select public.unregister_push_device($1)',[tokens[0]]);
    assert.equal((await a.query('select public.get_push_device_status($1) as enabled',[tokens[0]])).rows[0].enabled,false);
    await register(b);assert.equal((await a.query('select public.get_push_device_status($1) as enabled',[tokens[0]])).rows[0].enabled,false);
    await register(a);
    const replacement='ExpoPushToken[synthetic_replacement]';await register(a,replacement);await register(a);
    assert.equal((await admin.query('select * from public.push_devices where user_id=$1',[ids[0]])).rows.length,2);
  });
  await t.test('due selection uses server time and returns no secret schedule',async()=>{
    await a.query('select public.ensure_current_week()');
    schedule=(await admin.query("select * from private.daily_reveal_schedules where user_id=$1 and day_index=1",[ids[0]])).rows[0];
    await now(worker,new Date(schedule.exact_available_at).getTime()-1000);assert.equal((await claims()).length,0);
    await now(worker,schedule.exact_available_at);claimed=await claims();assert.equal(claimed.length,2);
    assert.deepEqual(Object.keys(claimed[0]),['delivery_id']);
  });
  await t.test('concurrent reservations send once per device and preserve reveal consumption',async()=>{
    const workers=await Promise.all(Array.from({length:8},()=>connect(null,'service_role',new Date(schedule.exact_available_at).toISOString())));
    const attempts=await Promise.all(workers.map(c=>c.query('select * from public.prepare_reveal_push($1)',[claimed[0].delivery_id])));
    assert.equal(attempts.filter(r=>r.rows.length).length,1);
    assert.equal(attempts.find(r=>r.rows.length).rows[0].ttl_seconds,300);
    await finish(claimed[0].delivery_id,'SENT','ticket-one');
    assert.equal((await prepare(claimed[0].delivery_id)).length,0);
    assert.equal((await claims()).length,1);
    assert.equal((await prepare(claimed[1].delivery_id)).length,1);
    await finish(claimed[1].delivery_id,'UNKNOWN',null,'NetworkFailure');
    assert.equal((await claims()).length,0);
    assert.equal((await admin.query('select consumed_at from public.daily_reveals where user_id=$1 and day_index=1',[ids[0]])).rows[0].consumed_at,null);
  });
  await t.test('receipt DeviceNotRegistered disables only its exact token, never resends',async()=>{
    await now(worker,new Date(schedule.exact_available_at).getTime()+16*60*1000);
    assert.equal((await worker.query('select * from public.pending_reveal_push_receipts()')).rows.length,1);
    await worker.query("select public.finish_reveal_push_receipt($1,'DeviceNotRegistered')",[claimed[0].delivery_id]);
    assert.equal((await admin.query('select count(*)::int as n from public.push_devices where enabled')).rows[0].n,1);
    assert.equal((await worker.query('select * from public.pending_reveal_push_receipts()')).rows.length,0);
  });
  await t.test('expired, locked, Sunday, disabled, and reassociated tokens are excluded',async()=>{
    await now(worker,schedule.exact_expires_at);assert.equal((await claims()).length,0);
    await now(worker,'2026-10-04T00:00:00+09:00');assert.equal((await claims()).length,0);
    await admin.query("update public.daily_reveals set state='LOCKED',consumed_at=now(),locked_at=now() where user_id=$1 and day_index=2",[ids[0]]);
    const second=(await admin.query('select exact_available_at from private.daily_reveal_schedules where user_id=$1 and day_index=2',[ids[0]])).rows[0];
    await now(worker,second.exact_available_at);assert.equal((await claims()).length,0);
    const third=(await admin.query('select exact_available_at from private.daily_reveal_schedules where user_id=$1 and day_index=3',[ids[0]])).rows[0];
    await now(worker,third.exact_available_at);const pending=await claims();assert.equal(pending.length,1);
    const actual=(await admin.query('select token_snapshot from private.reveal_push_deliveries where id=$1',[pending[0].delivery_id])).rows[0].token_snapshot;
    await register(b,actual,installs[1]);assert.equal((await prepare(pending[0].delivery_id)).length,0);
  });
  await t.test('trusted grants and search paths are narrow; scheduler fails closed without Vault',async()=>{
    const rows=(await admin.query("select proname,proconfig from pg_proc where proname in ('register_push_device','claim_due_reveal_pushes','prepare_reveal_push','finish_reveal_push','invoke_reveal_push_dispatch')")).rows;
    assert.equal(rows.length,5);rows.forEach(r=>assert.deepEqual(r.proconfig,['search_path=""']));
    await assert.rejects(a.query('select private.invoke_reveal_push_dispatch()'),{code:'42501'});
    assert.equal((await admin.query('select private.invoke_reveal_push_dispatch() as request')).rows[0].request,null);
  });
  await t.test('explicit temporary rejection retries within the window; token refresh and account return cannot duplicate a sent delivery',async()=>{
    const id=randomUUID(),install=randomUUID(),token='ExpoPushToken[synthetic_retry_device]';
    await admin.query('insert into auth.users values($1)',[id]);const client=await connect(id,'authenticated');
    await register(client,token,install);await client.query('select public.ensure_current_week()');
    const s=(await admin.query('select exact_available_at from private.daily_reveal_schedules where user_id=$1 and day_index=1',[id])).rows[0];
    await now(worker,s.exact_available_at);const due=await claims();const record=(await admin.query('select id from private.reveal_push_deliveries where user_id=$1',[id])).rows[0];
    assert.ok(due.some(r=>r.delivery_id===record.id));assert.equal((await prepare(record.id)).length,1);
    await finish(record.id,'RETRY',null,'MessageRateExceeded');assert.equal((await prepare(record.id)).length,0);
    await now(worker,new Date(s.exact_available_at).getTime()+60000);assert.equal((await prepare(record.id)).length,1);
    await finish(record.id,'SENT','retry-ticket');
    await register(client,'ExpoPushToken[synthetic_refreshed_retry_device]',install);
    await register(b,'ExpoPushToken[synthetic_refreshed_retry_device]',randomUUID());
    await register(client,'ExpoPushToken[synthetic_refreshed_retry_device]',install);
    assert.equal((await prepare(record.id)).length,0);
    assert.equal((await admin.query('select count(*)::int as n from private.reveal_push_deliveries where user_id=$1',[id])).rows[0].n,1);
  });
}));
