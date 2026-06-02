const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const client = require('openid-client');

const app = express();
const PORT = process.env.PORT || 5000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const PgSession = connectPgSimple(session);

async function initDatabase() {
  const dbClient = await pool.connect();
  try {
    // Session table for express-session (using 'sessions' to match PgSession config)
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR NOT NULL PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      )
    `);
    await dbClient.query(`CREATE INDEX IF NOT EXISTS IDX_sessions_expire ON sessions (expire)`);

    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        replit_id VARCHAR UNIQUE NOT NULL,
        email VARCHAR,
        first_name VARCHAR,
        last_name VARCHAR,
        profile_image VARCHAR,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS mercury_data (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        version INTEGER DEFAULT 1,
        initial_balances JSONB DEFAULT '{}',
        payrolls JSONB DEFAULT '[]',
        recurring_expenses JSONB DEFAULT '[]',
        one_off_expenses JSONB DEFAULT '[]',
        balance_overrides JSONB DEFAULT '{}',
        current_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
        archived_years JSONB DEFAULT '[]',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      )
    `);

    await dbClient.query(`ALTER TABLE mercury_data DROP CONSTRAINT IF EXISTS single_row`);
  } finally {
    dbClient.release();
  }
}

let oidcConfig = null;

function getCallbackUrl(req) {
  const domain = req?.hostname || process.env.REPLIT_DEV_DOMAIN || 
                 (process.env.REPLIT_DOMAINS ? process.env.REPLIT_DOMAINS.split(',')[0] : null);
  if (!domain) return null;
  return `https://${domain}/api/callback`;
}

async function setupOIDC() {
  try {
    const callbackUrl = getCallbackUrl();
    if (!callbackUrl) {
      console.log('No domain available for OIDC callback');
      return;
    }
    
    const issuerUrl = new URL(process.env.ISSUER_URL || 'https://replit.com/oidc');
    const clientId = process.env.REPL_ID;
    
    if (!clientId) {
      console.log('REPL_ID not available, OIDC disabled');
      return;
    }
    
    oidcConfig = await client.discovery(issuerUrl, clientId);
    console.log('OIDC configured successfully');
  } catch (error) {
    console.error('OIDC setup error:', error.message);
  }
}

app.use(express.json());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

app.set('trust proxy', 1);

const sessionTtl = 7 * 24 * 60 * 60 * 1000;

// Session secret handling - fail in production if not set
const isProduction = process.env.NODE_ENV === 'production';
let sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  if (isProduction) {
    console.error('FATAL: SESSION_SECRET must be set in production environment');
    process.exit(1);
  }
  console.warn('Warning: SESSION_SECRET not set, using ephemeral secret (sessions will not persist across restarts)');
  sessionSecret = require('crypto').randomBytes(32).toString('hex');
}

app.use(session({
  store: new PgSession({
    pool,
    tableName: 'sessions',
    createTableIfMissing: false,
    ttl: sessionTtl / 1000,
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    maxAge: sessionTtl,
    sameSite: 'lax',
  },
}));

app.get('/api/login', async (req, res) => {
  if (!oidcConfig) {
    return res.redirect('/?auth_error=not_available');
  }
  
  try {
    const callbackUrl = getCallbackUrl(req);
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    
    req.session.auth = {
      codeVerifier,
      state,
      nonce,
      redirectUri: callbackUrl,
    };
    
    const authUrl = client.buildAuthorizationUrl(oidcConfig, {
      redirect_uri: callbackUrl,
      scope: 'openid email profile offline_access',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'login consent',
    });
    
    res.redirect(authUrl.href);
  } catch (error) {
    console.error('Login initiation error:', error);
    res.redirect('/?auth_error=login_failed');
  }
});

app.get('/api/callback', async (req, res) => {
  if (!oidcConfig || !req.session.auth) {
    return res.redirect('/?auth_error=session_expired');
  }
  
  try {
    const { codeVerifier, state, nonce, redirectUri } = req.session.auth;
    const currentUrl = new URL(`https://${req.headers.host}${req.url}`);
    
    const tokens = await client.authorizationCodeGrant(oidcConfig, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState: state,
      expectedNonce: nonce,
      idTokenExpected: true,
    });
    
    const claims = tokens.claims();
    
    const result = await pool.query(`
      INSERT INTO users (replit_id, email, first_name, last_name, profile_image, updated_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (replit_id) DO UPDATE SET
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        profile_image = EXCLUDED.profile_image,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, replit_id, email, first_name, last_name, profile_image
    `, [
      claims.sub,
      claims.email || null,
      claims.first_name || claims.given_name || null,
      claims.last_name || claims.family_name || null,
      claims.profile_image_url || claims.picture || null,
    ]);
    
    req.session.userId = result.rows[0].id;
    req.session.user = result.rows[0];
    delete req.session.auth;
    
    res.redirect('/');
  } catch (error) {
    console.error('Auth callback error:', error);
    delete req.session.auth;
    res.redirect('/?auth_error=callback_failed');
  }
});

app.get('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.redirect('/');
  });
});

app.get('/api/auth/user', (req, res) => {
  res.json({ user: req.session?.user || null });
});

function isAuthenticated(req, res, next) {
  if (req.session?.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// Input validation helpers
const validators = {
  isValidPayroll: (payroll) => {
    if (!payroll || typeof payroll !== 'object') return false;
    if (typeof payroll.name !== 'string' || payroll.name.trim() === '') return false;
    if (typeof payroll.amount !== 'number' || payroll.amount < 0) return false;
    const validFrequencies = ['weekly', 'biweekly', 'monthly', 'semimonthly', 'last-weekday-15th', 'last-weekday-eom'];
    if (!validFrequencies.includes(payroll.frequency)) return false;
    return true;
  },
  isValidRecurringExpense: (expense) => {
    if (!expense || typeof expense !== 'object') return false;
    if (typeof expense.name !== 'string' || expense.name.trim() === '') return false;
    if (typeof expense.amount !== 'number' || expense.amount < 0) return false;
    const validFrequencies = ['weekly', 'monthly', 'yearly'];
    if (!validFrequencies.includes(expense.frequency)) return false;
    return true;
  },
  isValidOneOffExpense: (expense) => {
    if (!expense || typeof expense !== 'object') return false;
    if (typeof expense.name !== 'string' || expense.name.trim() === '') return false;
    if (typeof expense.amount !== 'number' || expense.amount < 0) return false;
    if (typeof expense.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expense.date)) return false;
    return true;
  },
  isValidFinancialData: (data) => {
    if (!data || typeof data !== 'object') return { valid: false, error: 'Invalid data format' };

    // Validate payrolls array
    if (data.payrolls && Array.isArray(data.payrolls)) {
      for (const payroll of data.payrolls) {
        if (!validators.isValidPayroll(payroll)) {
          return { valid: false, error: 'Invalid payroll entry' };
        }
      }
    }

    // Validate recurring expenses array
    if (data.recurringExpenses && Array.isArray(data.recurringExpenses)) {
      for (const expense of data.recurringExpenses) {
        if (!validators.isValidRecurringExpense(expense)) {
          return { valid: false, error: 'Invalid recurring expense entry' };
        }
      }
    }

    // Validate one-off expenses array
    if (data.oneOffExpenses && Array.isArray(data.oneOffExpenses)) {
      for (const expense of data.oneOffExpenses) {
        if (!validators.isValidOneOffExpense(expense)) {
          return { valid: false, error: 'Invalid one-off expense entry' };
        }
      }
    }

    // Validate currentYear if provided
    if (data.currentYear !== undefined) {
      if (typeof data.currentYear !== 'number' || data.currentYear < 2000 || data.currentYear > 2100) {
        return { valid: false, error: 'Invalid year' };
      }
    }

    return { valid: true };
  }
};

app.get('/api/data', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userId;
    const result = await pool.query('SELECT * FROM mercury_data WHERE user_id = $1', [userId]);
    
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

app.post('/api/data', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userId;
    const data = req.body;

    // Validate incoming data
    const validation = validators.isValidFinancialData(data);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    await pool.query(`
      INSERT INTO mercury_data (user_id, version, initial_balances, payrolls, recurring_expenses, one_off_expenses, balance_overrides, current_year, archived_years, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET
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
      userId,
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

app.patch('/api/data/:field', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { field } = req.params;
    const { value } = req.body;

    // Use explicit query for each field to avoid SQL injection via string interpolation
    // Each field has its own parameterized query with the column name hardcoded
    const updateQueries = {
      'initialBalances': 'UPDATE mercury_data SET initial_balances = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      'payrolls': 'UPDATE mercury_data SET payrolls = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      'recurringExpenses': 'UPDATE mercury_data SET recurring_expenses = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      'oneOffExpenses': 'UPDATE mercury_data SET one_off_expenses = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      'balanceOverrides': 'UPDATE mercury_data SET balance_overrides = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      'currentYear': 'UPDATE mercury_data SET current_year = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      'archivedYears': 'UPDATE mercury_data SET archived_years = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2'
    };

    const query = updateQueries[field];
    if (!query) {
      return res.status(400).json({ error: 'Invalid field' });
    }

    // Validate value is present
    if (value === undefined) {
      return res.status(400).json({ error: 'Missing value in request body' });
    }

    const paramValue = field === 'currentYear' ? value : JSON.stringify(value);
    await pool.query(query, [paramValue, userId]);

    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error updating field:', error);
    res.status(500).json({ error: 'Failed to update field' });
  }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

async function startServer() {
  try {
    await initDatabase();
    await setupOIDC();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Mercury is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
