const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual registered callback without opening the application database
// or replacing its production authentication/session middleware.
const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const callbackSource = source.match(/app\.get\('\/api\/callback', (async \(req, res\) => \{[\s\S]*?\n\})\);/)[1];
function fixture({ configured = true, pending = true, grantError, databaseError, saveError } = {}) {
  const events = [];
  const user = { id: 17, replit_id: 'isolated-auth-test', first_name: 'Test' };
  let completeSave, grantOptions;
  const req = {
    headers: { host: 'mercury.example' },
    url: '/api/callback?code=test&state=expected-state',
    session: {
      ...(pending ? { auth: { codeVerifier: 'test-verifier', state: 'expected-state', nonce: 'test-nonce' } } : {}),
      save(callback) {
        events.push('save-started');
        completeSave = () => { events.push('save-completed'); callback(saveError); };
      },
    },
  };
  const callback = vm.runInNewContext(`(${callbackSource})`, {
    URL,
    oidcConfig: configured ? {} : null,
    client: { async authorizationCodeGrant(config, url, options) {
      events.push('grant'); grantOptions = options;
      if (grantError) throw grantError;
      return { claims: () => ({ sub: user.replit_id, first_name: user.first_name }) };
    } },
    pool: { async query() {
      events.push('user-upsert');
      if (databaseError) throw databaseError;
      return { rows: [user] };
    } },
    console: { error() {} },
  });
  const destinations = [];
  const res = { redirect(destination) { events.push('redirect'); destinations.push(destination); } };
  return { req, user, callback, res, events, destinations, finishSave: () => completeSave(), options: () => grantOptions };
}

test('successful new and returning sign-ins wait for session persistence and go directly to dashboard', async () => {
  for (const returning of [false, true]) {
    const f = fixture();
    if (returning) Object.assign(f.req.session, { userId: f.user.id, user: f.user });
    const response = f.callback(f.req, f.res);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.destinations, [], 'must not redirect while session is still saving');
    assert.equal(f.req.session.userId, f.user.id);
    assert.equal(f.req.session.user, f.user);
    assert.equal(f.req.session.auth, undefined, 'consume the pending OIDC attempt');
    assert.equal(f.options().pkceCodeVerifier, 'test-verifier');
    assert.equal(f.options().expectedState, 'expected-state');
    assert.equal(f.options().expectedNonce, 'test-nonce');
    assert.equal(f.options().idTokenExpected, true);
    f.finishSave();
    await response;
    assert.deepEqual(f.destinations, ['/#app/dashboard']);
    assert.deepEqual(f.events, ['grant', 'user-upsert', 'save-started', 'save-completed', 'redirect']);
  }
});
test('unconfigured or expired authentication still returns to the homepage error route', async () => {
  for (const options of [{ configured: false }, { pending: false }]) {
    const f = fixture(options);
    await f.callback(f.req, f.res);
    assert.deepEqual(f.destinations, ['/?auth_error=session_expired']);
    assert.deepEqual(f.events, ['redirect']);
  }
});
test('cancelled or invalid grants and failed user writes retain callback failure handling', async () => {
  for (const options of [{ grantError: new Error('cancelled or invalid grant') }, { databaseError: new Error('write failed') }]) {
    const f = fixture(options);
    await f.callback(f.req, f.res);
    assert.deepEqual(f.destinations, ['/?auth_error=callback_failed']);
    assert.equal(f.req.session.userId, undefined);
    assert.equal(f.req.session.auth, undefined);
    assert.ok(!f.events.includes('save-started'));
  }
});
test('a session-store failure cannot report successful dashboard sign-in', async () => {
  const f = fixture({ saveError: new Error('store unavailable') });
  const response = f.callback(f.req, f.res);
  await new Promise(resolve => setImmediate(resolve));
  f.finishSave();
  await response;
  assert.deepEqual(f.destinations, ['/?auth_error=callback_failed']);
  assert.equal(f.req.session.userId, undefined);
  assert.equal(f.req.session.user, undefined);
});
