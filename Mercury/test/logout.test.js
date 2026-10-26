const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const express = require('express');
const session = require('express-session');
const logoutRouter = require('../routes/logout');

let server;
let baseUrl;
const store = new session.MemoryStore();

before(async () => {
  const app = express();
  app.use(session({
    secret: 'logout-regression-test-only',
    store,
    resave: false,
    saveUninitialized: false,
  }));
  // These helpers exist only in this test server, never in the application.
  app.post('/test/login', (req, res) => {
    req.session.userId = 123;
    res.sendStatus(204);
  });
  app.get('/test/session', (req, res) => {
    res.json({ userId: req.session.userId || null });
  });
  app.use('/api/logout', logoutRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise(resolve => {
  server.close(resolve);
  server.closeAllConnections();
}));

async function login() {
  const response = await fetch(`${baseUrl}/test/login`, { method: 'POST' });
  assert.equal(response.status, 204);
  return response.headers.get('set-cookie').split(';')[0];
}

async function sessionUser(cookie) {
  const response = await fetch(`${baseUrl}/test/session`, { headers: { Cookie: cookie } });
  return (await response.json()).userId;
}

for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
  test(`${method} cannot destroy a session or authorize CORS`, async () => {
    const cookie = await login();
    const response = await fetch(`${baseUrl}/api/logout`, {
      method,
      headers: {
        Cookie: cookie,
        Origin: 'https://attacker.example',
        'X-Mercury-CSRF': '1',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'X-Mercury-CSRF',
      },
    });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(await sessionUser(cookie), 123);
  });
}

for (const headers of [
  {},
  { Origin: 'https://attacker.example', 'Content-Type': 'application/x-www-form-urlencoded' },
  { Origin: 'https://attacker.example', 'Content-Type': 'text/plain' },
  { 'X-Mercury-CSRF': 'wrong' },
]) {
  test(`POST rejects a missing/invalid CSRF header (${JSON.stringify(headers)})`, async () => {
    const cookie = await login();
    const response = await fetch(`${baseUrl}/api/logout`, {
      method: 'POST',
      headers: { Cookie: cookie, ...headers },
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(await sessionUser(cookie), 123);
  });
}

test('protected POST destroys the server session and expires the cookie', async () => {
  const cookie = await login();
  const response = await fetch(`${baseUrl}/api/logout`, {
    method: 'POST',
    headers: { Cookie: cookie, 'X-Mercury-CSRF': '1' },
  });
  assert.equal(response.status, 204);
  const clearedCookie = response.headers.get('set-cookie');
  assert.match(clearedCookie, /^connect\.sid=;/);
  assert.match(clearedCookie, /Expires=Thu, 01 Jan 1970/);
  assert.match(clearedCookie, /HttpOnly; Secure; SameSite=Lax/);
  // Replay the original cookie to verify server-side invalidation too.
  assert.equal(await sessionUser(cookie), null);
});

test('session-store failures do not report a successful logout', async () => {
  const cookie = await login();
  const originalDestroy = store.destroy;
  const originalError = console.error;
  store.destroy = (sid, callback) => callback(new Error('test store failure'));
  console.error = () => {};
  try {
    const response = await fetch(`${baseUrl}/api/logout`, {
      method: 'POST',
      headers: { Cookie: cookie, 'X-Mercury-CSRF': '1' },
    });
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(await sessionUser(cookie), 123);
  } finally {
    store.destroy = originalDestroy;
    console.error = originalError;
  }
});
