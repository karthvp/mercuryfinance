const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 5000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS mercury_data (
        id INTEGER PRIMARY KEY DEFAULT 1,
        version INTEGER DEFAULT 1,
        initial_balances JSONB DEFAULT '{}',
        payrolls JSONB DEFAULT '[]',
        recurring_expenses JSONB DEFAULT '[]',
        one_off_expenses JSONB DEFAULT '[]',
        balance_overrides JSONB DEFAULT '{}',
        current_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
        archived_years JSONB DEFAULT '[]',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT single_row CHECK (id = 1)
      )
    `);
    
    const currentYear = new Date().getFullYear();
    await client.query(`
      INSERT INTO mercury_data (id, version, initial_balances, payrolls, recurring_expenses, one_off_expenses, balance_overrides, current_year, archived_years)
      VALUES (1, 1, $1, '[]', '[]', '[]', '{}', $2, '[]')
      ON CONFLICT (id) DO NOTHING
    `, [JSON.stringify({ [currentYear]: 5000 }), currentYear]);
  } finally {
    client.release();
  }
}

app.use(express.json());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});
app.use(express.static(__dirname));

app.get('/api/data', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM mercury_data WHERE id = 1');
    if (result.rows.length === 0) {
      return res.json({
        version: 1,
        initialBalances: {},
        payrolls: [],
        recurringExpenses: [],
        oneOffExpenses: [],
        balanceOverrides: {},
        currentYear: new Date().getFullYear(),
        archivedYears: []
      });
    }
    const row = result.rows[0];
    res.json({
      version: row.version,
      initialBalances: row.initial_balances,
      payrolls: row.payrolls,
      recurringExpenses: row.recurring_expenses,
      oneOffExpenses: row.one_off_expenses,
      balanceOverrides: row.balance_overrides,
      currentYear: row.current_year,
      archivedYears: row.archived_years
    });
  } catch (error) {
    console.error('Error reading data:', error);
    res.status(500).json({ error: 'Failed to read data' });
  }
});

app.post('/api/data', async (req, res) => {
  try {
    const data = req.body;
    await pool.query(`
      INSERT INTO mercury_data (id, version, initial_balances, payrolls, recurring_expenses, one_off_expenses, balance_overrides, current_year, archived_years, updated_at)
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        version = EXCLUDED.version,
        initial_balances = EXCLUDED.initial_balances,
        payrolls = EXCLUDED.payrolls,
        recurring_expenses = EXCLUDED.recurring_expenses,
        one_off_expenses = EXCLUDED.one_off_expenses,
        balance_overrides = EXCLUDED.balance_overrides,
        current_year = EXCLUDED.current_year,
        archived_years = EXCLUDED.archived_years,
        updated_at = CURRENT_TIMESTAMP
    `, [
      data.version || 1,
      JSON.stringify(data.initialBalances || {}),
      JSON.stringify(data.payrolls || []),
      JSON.stringify(data.recurringExpenses || []),
      JSON.stringify(data.oneOffExpenses || []),
      JSON.stringify(data.balanceOverrides || {}),
      data.currentYear || new Date().getFullYear(),
      JSON.stringify(data.archivedYears || [])
    ]);
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error saving data:', error);
    res.status(500).json({ error: 'Failed to save data' });
  }
});

app.patch('/api/data/:field', async (req, res) => {
  try {
    const { field } = req.params;
    const { value } = req.body;
    
    const fieldMapping = {
      'initialBalances': 'initial_balances',
      'payrolls': 'payrolls',
      'recurringExpenses': 'recurring_expenses',
      'oneOffExpenses': 'one_off_expenses',
      'balanceOverrides': 'balance_overrides',
      'currentYear': 'current_year',
      'archivedYears': 'archived_years'
    };
    
    const dbField = fieldMapping[field];
    if (!dbField) {
      return res.status(400).json({ error: 'Invalid field' });
    }
    
    const jsonValue = dbField === 'current_year' ? value : JSON.stringify(value);
    await pool.query(`UPDATE mercury_data SET ${dbField} = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1`, [jsonValue]);
    
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error updating field:', error);
    res.status(500).json({ error: 'Failed to update field' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

async function startServer() {
  await initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Mercury is running on port ${PORT}`);
  });
}

startServer().catch(console.error);
