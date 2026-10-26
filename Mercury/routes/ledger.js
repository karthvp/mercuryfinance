const express = require('express');
const { createHash } = require('node:crypto');
const model = require('../ledger-model');

async function userTransaction(pool, userId, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // All document and ledger writes acquire this same per-user lock in the same order.
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [userId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
async function initLedgerTables(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS mercury_reconciliation (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0,
    ledger JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS mercury_reconciliation_writes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id VARCHAR(100) NOT NULL,
    body_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, request_id)
  )`);
}
function todayIn(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function createLedgerRouter({ pool, isAuthenticated, readPlan }) {
  const router = express.Router();
  router.use(isAuthenticated);
  router.get('/', async (req, res) => {
    try {
      const result = await userTransaction(pool, req.session.userId, async client => {
        let { rows } = await client.query('SELECT revision, ledger FROM mercury_reconciliation WHERE user_id=$1', [req.session.userId]);
        if (!rows.length) {
          const timeZone = req.get('X-Mercury-Timezone') || 'UTC';
          const today = todayIn(timeZone);
          const ledger = model.initialLedger(await readPlan(client, req.session.userId), today);
          ledger.timeZone = timeZone;
          ({ rows } = await client.query('INSERT INTO mercury_reconciliation(user_id,ledger) VALUES($1,$2) RETURNING revision,ledger', [req.session.userId, JSON.stringify(ledger)]));
        }
        return rows[0];
      });
      res.json(result);
    } catch (error) {
      console.error('Reconciliation load failed:', error.message);
      res.status(500).json({ error: 'Could not load accounts and actual transactions.' });
    }
  });
  router.put('/', async (req, res) => {
    if (req.get('X-Mercury-CSRF') !== '1') return res.status(403).json({ error: 'Missing request protection header.' });
    if (req.get('origin') && req.get('origin') !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Invalid request origin.' });
    const { revision, requestId, ledger } = req.body || {};
    if (!Number.isSafeInteger(revision) || revision < 0 || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId) || !ledger) return res.status(400).json({ error: 'A revision and unique write identifier are required.' });
    try {
      const result = await userTransaction(pool, req.session.userId, async client => {
        const { rows } = await client.query('SELECT revision,ledger FROM mercury_reconciliation WHERE user_id=$1', [req.session.userId]);
        if (!rows.length) return { status: 409, body: { error: 'Load accounts before saving.' } };
        const current = rows[0], hash = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
        const receipt = await client.query('SELECT body_hash FROM mercury_reconciliation_writes WHERE user_id=$1 AND request_id=$2', [req.session.userId, requestId]);
        if (receipt.rows.length) {
          return receipt.rows[0].body_hash === hash
            ? { status: 200, body: { ...current, replayed: true } }
            : { status: 409, body: { error: 'This write identifier was already used for a different change.' } };
        }
        if (current.revision !== revision) return { status: 409, body: { error: 'Another tab saved a newer version. Reload latest before making this change.' } };
        if (ledger.timeZone !== current.ledger.timeZone) return { status: 400, body: { error: 'Keep the account calendar timezone unchanged.' } };
        try { model.validate(ledger, await readPlan(client, req.session.userId), todayIn(current.ledger.timeZone || 'UTC'), current.ledger); }
        catch (error) { return { status: 400, body: { error: error.message } }; }
        const updated = await client.query('UPDATE mercury_reconciliation SET ledger=$1,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=$2 RETURNING revision,ledger', [JSON.stringify(ledger), req.session.userId]);
        await client.query('INSERT INTO mercury_reconciliation_writes(user_id,request_id,body_hash) VALUES($1,$2,$3)', [req.session.userId, requestId, hash]);
        return { status: 200, body: updated.rows[0] };
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      console.error('Reconciliation save failed:', error.message);
      res.status(500).json({ error: 'Your changes were not confirmed. Reload latest before retrying.' });
    }
  });
  return router;
}
module.exports = { createLedgerRouter, initLedgerTables, userTransaction, todayIn };
