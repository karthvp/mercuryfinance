const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const { createLedgerRouter, initLedgerTables, todayIn } = require('../routes/ledger');
const model = require('../ledger-model');
const repairDocumentSequence = require('../document-sequence');

// Isolated schema only. Never touches application users, records or sessions.
const enabled = !!process.env.DATABASE_URL;
const schema = `ledger_test_${randomBytes(6).toString('hex')}`;
let admin, pool, server, base;
const today = todayIn('UTC');
const plan = { initialBalances: { [today.slice(0, 4)]: 0 }, oneOffIncomes: [{ id: 'pay', name: 'Salary', amount: 100, date: today }], payrolls: [], recurringExpenses: [], oneOffExpenses: [], debts: [] };

before(async () => {
  if (!enabled) return;
  admin = new Pool({ connectionString: process.env.DATABASE_URL });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
  await pool.query('CREATE TABLE users(id INTEGER PRIMARY KEY)');
  await pool.query('INSERT INTO users(id) VALUES(1),(2)');
  await initLedgerTables(pool);
  await pool.query('CREATE TABLE mercury_data(id SERIAL PRIMARY KEY, user_id INTEGER)');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { if (req.get('X-Test-User')) req.session = { userId: Number(req.get('X-Test-User')) }; next(); });
  app.use('/api/ledger', createLedgerRouter({
    pool, readPlan: async () => plan,
    isAuthenticated: (req, res, next) => req.session?.userId ? next() : res.status(401).json({ error: 'Unauthorized' }),
  }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/ledger`;
});
test('legacy explicit document ids cannot block new-user saves, and sequence repair never rewinds', { skip: !enabled }, async () => {
  await pool.query('INSERT INTO mercury_data(id,user_id) VALUES(1,1),(7,2)');
  const client = await pool.connect();
  try {
    await repairDocumentSequence(client);
    assert.equal((await client.query('INSERT INTO mercury_data(user_id) VALUES(3) RETURNING id')).rows[0].id, 8);
    await client.query("SELECT setval(pg_get_serial_sequence('mercury_data','id'),100,true)");
    await repairDocumentSequence(client);
    assert.equal((await client.query('INSERT INTO mercury_data(user_id) VALUES(4) RETURNING id')).rows[0].id, 101);
    await client.query('ALTER TABLE mercury_data ALTER COLUMN id SET DEFAULT 1');
    await client.query('DROP SEQUENCE mercury_data_id_seq');
    await repairDocumentSequence(client);
    assert.equal((await client.query('INSERT INTO mercury_data(user_id) VALUES(5) RETURNING id')).rows[0].id, 102, 'a legacy literal DEFAULT 1 is restored to a proper owned sequence');
  } finally { client.release(); }
});
after(async () => {
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  if (pool) await pool.end();
  if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
});
const headers = user => ({ 'X-Test-User': String(user), 'X-Mercury-CSRF': '1', 'Content-Type': 'application/json' });
async function get(user) { const r = await fetch(base, { headers: headers(user) }); return r.json(); }
async function put(user, body, extra = {}) {
  const response = await fetch(base, { method: 'PUT', headers: { ...headers(user), ...extra }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
test('authenticated ledger saves are durable, isolated, revisioned, idempotent and allocation-safe', { skip: !enabled }, async () => {
  assert.equal((await fetch(base)).status, 401);
  const first = await get(1), other = await get(2);
  assert.equal(first.revision, 0);
  assert.equal(other.ledger.transactions.length, 0);
  const ledger = structuredClone(first.ledger);
  ledger.transactions.push({ id: 'deposit', accountId: model.OPENING, direction: 'income', date: today, amountCents: 7500, description: 'Actual salary' });
  const key = model.occurrenceKey('income', 'oneoff', 'pay', today);
  ledger.allocations.push({ id: 'match', transactionId: 'deposit', occurrenceKey: key, amountCents: 7500 });
  const request = { requestId: 'write-00000001', revision: 0, ledger };
  const saved = await put(1, request);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 1);
  assert.equal((await get(1)).ledger.allocations[0].amountCents, 7500);
  assert.equal((await get(2)).ledger.transactions.length, 0, 'cannot read the other owner’s ledger');
  const replay = await put(1, request);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.revision, 1);
  assert.equal(replay.body.replayed, true);
  const stale = await put(1, { ...request, requestId: 'write-00000002' });
  assert.equal(stale.status, 409);
  const reused = await put(1, { ...request, ledger: first.ledger });
  assert.equal(reused.status, 409);
  const tooMuch = structuredClone(ledger);
  tooMuch.allocations.push({ id: 'extra', transactionId: 'deposit', occurrenceKey: key, amountCents: 1 });
  assert.equal((await put(1, { requestId: 'write-00000003', revision: 1, ledger: tooMuch })).status, 400);
  assert.equal((await get(1)).revision, 1, 'invalid write does not change durable data');
  const forgery = await put(1, { requestId: 'write-00000004', revision: 1, ledger }, { Origin: 'https://attacker.example' });
  assert.equal(forgery.status, 403);
  const missingHeader = await put(1, { requestId: 'write-00000005', revision: 1, ledger }, { 'X-Mercury-CSRF': '' });
  assert.equal(missingHeader.status, 403);
  const competing = await Promise.all([put(1, { requestId: 'write-00000006', revision: 1, ledger }), put(1, { requestId: 'write-00000007', revision: 1, ledger })]);
  assert.deepEqual(competing.map(r => r.status).sort(), [200, 409], 'only one concurrent revision wins');
  const latest = await get(1);
  const undo = structuredClone(latest.ledger);
  undo.allocations = [];
  undo.transactions[0].amountCents = 8000;
  assert.equal((await put(1, { requestId: 'write-00000008', revision: latest.revision, ledger: undo })).status, 200);
  const reloaded = await get(1);
  assert.equal(reloaded.ledger.transactions[0].amountCents, 8000);
  assert.equal(reloaded.ledger.allocations.length, 0);
});
