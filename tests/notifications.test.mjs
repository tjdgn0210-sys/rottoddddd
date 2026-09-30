import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationRoute } from '../domain/notifications.ts';
import { buildRevealPush, sendRevealPush, dispatchDuePushes } from '../supabase/functions/dispatch-reveal-notifications/delivery.ts';

const push = { token: 'ExpoPushToken[synthetic_test_token]', ttl_seconds: 240 };
const response = (data, status = 200) => async () => Response.json(data, { status });
test('payload carries only a safe route marker and tap never consumes', () => {
  const payload = buildRevealPush(push);
  assert.deepEqual(payload.data, { type: 'DAILY_REVEAL' });
  assert.equal(payload.ttl, 240);
  assert.doesNotMatch(JSON.stringify(payload), /exact_|numbers|weekStart|user_id|point/);
  assert.equal(notificationRoute(payload.data), '/reveal');
  assert.equal(notificationRoute({ type: 'OTHER', url: '/submission' }), null);
  assert.equal(notificationRoute(null), null);
});
test('Expo tickets, invalid tokens, temporary errors, and ambiguous outcomes are distinct', async () => {
  assert.deepEqual(await sendRevealPush(push,response({data:{status:'ok',id:'ticket-1'}})),{outcome:'SENT',ticket:'ticket-1',error:null});
  assert.equal((await sendRevealPush(push,response({data:{status:'error',details:{error:'DeviceNotRegistered'}}}))).outcome,'FAILED');
  assert.equal((await sendRevealPush(push,response({data:{status:'error',details:{error:'MessageRateExceeded'}}}))).outcome,'RETRY');
  assert.equal((await sendRevealPush(push,response({},429))).outcome,'RETRY');
  assert.equal((await sendRevealPush(push,response({},503))).outcome,'UNKNOWN');
  assert.equal((await sendRevealPush(push,async()=>{throw new Error('offline');})).outcome,'UNKNOWN');
  assert.equal((await sendRevealPush(push,response({unexpected:true}))).outcome,'UNKNOWN');
});
test('dispatcher rechecks each claim and records tickets without consuming', async () => {
  let requests = 0; const finished = [];
  const repository = { claim: async()=>[{delivery_id:'active'},{delivery_id:'expired'}],
    prepare: async(id)=>id==='active'?[push]:[], finish: async(id,result)=>finished.push({id,...result}) };
  const summary = await dispatchDuePushes(repository,async(_url,options)=>{
    requests++; assert.deepEqual(JSON.parse(options.body).data,{type:'DAILY_REVEAL'});
    return Response.json({data:{status:'ok',id:'ticket'}});
  });
  assert.equal(requests,1);assert.equal(summary.sent,1);assert.equal(summary.skipped,1);
  assert.deepEqual(finished,[{id:'active',outcome:'SENT',ticket:'ticket',error:null}]);
});
test('Edge handler fails closed without configuration and rejects ordinary invocations before database access', async () => {
  const values=new Map();let handler;const original=globalThis.Deno;
  globalThis.Deno={env:{get:key=>values.get(key)},serve:fn=>{handler=fn;}};
  try {
    await import('../supabase/functions/dispatch-reveal-notifications/index.ts');
    assert.equal((await handler(new Request('https://test.invalid',{method:'POST'}))).status,503);
    values.set('REVEAL_DISPATCH_SECRET','synthetic-test-invocation-secret-only');
    assert.equal((await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer ordinary-user'}}))).status,401);
    assert.equal((await handler(new Request('https://test.invalid',{method:'GET',headers:{'x-reveal-dispatch-secret':values.get('REVEAL_DISPATCH_SECRET')}}))).status,405);
  } finally { if(original===undefined)delete globalThis.Deno;else globalThis.Deno=original; }
});
