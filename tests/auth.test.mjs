import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAuthInput, getAuthErrorMessage } from '../domain/auth.ts';
import { observeSession } from '../lib/authSession.ts';

test('auth validation normalizes email only and checks sign-up confirmation', () => {
  assert.equal(validateAuthInput('signIn', ' person@example.com ', ' secret ', ''), null);
  assert.ok(validateAuthInput('signIn', 'invalid', 'secret', ''));
  assert.ok(validateAuthInput('signIn', 'person@example.com', '', ''));
  assert.ok(validateAuthInput('signUp', 'person@example.com', 'secret', 'different'));
  assert.equal(validateAuthInput('signUp', 'person@example.com', 'secret', 'secret'), null);
});

test('auth errors are actionable and never expose backend internals', () => {
  for (const code of ['invalid_credentials', 'email_not_confirmed', 'email_exists', 'weak_password', 'over_request_rate_limit', 'session_not_found']) {
    assert.notEqual(getAuthErrorMessage({ code }), getAuthErrorMessage({}));
  }
  assert.match(getAuthErrorMessage(new TypeError('Failed to fetch')), /인터넷/);
  assert.doesNotMatch(getAuthErrorMessage({ message: 'SQL private.weekly_secrets database stack trace' }), /SQL|private|stack/);
});

function fixture() {
  let callback;
  let resolve;
  let unsubscribed = false;
  let userError = null;
  const received = [];
  const errors = [];
  const pending = new Promise((done) => { resolve = done; });
  const client = { auth: {
    onAuthStateChange: (listener) => { callback = listener; return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } }; },
    getSession: () => pending,
    getUser: async () => ({ data: {}, error: userError }),
  } };
  const stop = observeSession(client, (session) => received.push(session), (error) => errors.push(error));
  return { received, errors, stop, emit: (event, session) => callback(event, session),
    restore: async (session, error = null) => { resolve({ data: { session }, error }); await new Promise(setImmediate); },
    setUserError: (error) => { userError = error; }, isUnsubscribed: () => unsubscribed };
}

test('restoration validates persisted session before exposing protected screens', async () => {
  const f = fixture();
  const session = { user: { id: 'own-user' } };
  f.emit('INITIAL_SESSION', session);
  assert.deepEqual(f.received, []);
  await f.restore(session);
  assert.deepEqual(f.received, [session]);
  f.stop();
});

test('a late restore cannot undo sign-out or account change', async () => {
  const f = fixture();
  f.emit('SIGNED_OUT', null);
  await f.restore({ user: { id: 'old-user' } });
  assert.deepEqual(f.received, [null]);
  f.emit('SIGNED_IN', { user: { id: 'new-user' } });
  f.emit('TOKEN_REFRESHED', { user: { id: 'new-user' }, access_token: 'refreshed' });
  assert.equal(f.received.length, 3);
  f.stop();
});

test('cleanup unsubscribes and prevents pending updates', async () => {
  const f = fixture();
  f.stop();
  await f.restore(null);
  f.emit('SIGNED_IN', {});
  assert.equal(f.isUnsubscribed(), true);
  assert.deepEqual(f.received, []);
});

test('restoration and revoked-user failures fail closed', async () => {
  for (const revoked of [false, true]) {
    const f = fixture();
    const error = { code: revoked ? 'session_not_found' : 'network_failure' };
    if (revoked) f.setUserError(error);
    await f.restore({ user: { id: 'old-user' } }, revoked ? null : error);
    assert.deepEqual(f.received, []);
    assert.deepEqual(f.errors, [error]);
    f.stop();
  }
});
