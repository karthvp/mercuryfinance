const { test: base, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// This is a browser-only origin. No server, credentials, database, or real API.
const ORIGIN = 'http://mercury.test';
const ROOT = path.resolve(__dirname, '../..');
// jsDelivr re-minifies Chart.js; npm ships the same version's upstream UMD.
// Adapt ONLY that script's SRI to the pinned local bytes, keeping SRI enabled.
const chartHash = crypto.createHash('sha384')
  .update(fs.readFileSync(path.join(ROOT, 'node_modules/chart.js/dist/chart.umd.js')))
  .digest('base64');
const HTML = fs.readFileSync(path.join(ROOT, 'Mercury/index.html'), 'utf8')
  .replace(/(src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@4\.4\.1\/dist\/chart\.umd\.min\.js" integrity=")sha384-[^"]+"/,
    `$1sha384-${chartHash}"`);
const libraries = new Map([
  ['https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js', 'react/umd/react.production.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js', 'react-dom/umd/react-dom.production.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js', '@babel/standalone/babel.min.js'],
  ['https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js', 'chart.js/dist/chart.umd.js'],
  ['https://d3js.org/d3.v7.min.js', 'd3/dist/d3.min.js'],
  ['https://unpkg.com/d3-sankey@0.12.3/dist/d3-sankey.min.js', 'd3-sankey/dist/d3-sankey.min.js'],
]);

function initialData() {
  return {
    version: 2, currentYear: 2026, archivedYears: [],
    initialBalances: { 2026: 5000 },
    payrolls: [{ id: 1, name: 'Fixture salary', amount: 2400, frequency: 'monthly', startDay: 1 }],
    recurringExpenses: [{ id: 2, name: 'Fixture rent', amount: 900, frequency: 'monthly', dayOfMonth: 5 }],
    oneOffIncomes: [], oneOffExpenses: [], balanceOverrides: {}, debts: [],
  };
}

const test = base.extend({
  finance: async ({ context, page }, use) => {
    let data = initialData();
    const writes = [];
    const unexpected = [];
    const errors = [];
    const apiRequests = [];
    const auth = { user: { id: 'browser-fixture', first_name: 'Test', email: 'test@example.invalid' }, dataStatus: 200 };
    page.on('pageerror', error => errors.push(error.message));
    // Fix Date only, not timers: debounce saves and React effects must run normally.
    await page.clock.setFixedTime(new Date('2026-06-15T12:00:00Z'));
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const reply = (body, status = 200) => route.fulfill({ status, json: body });
      if (libraries.has(url.href)) {
        return route.fulfill({
          contentType: 'application/javascript',
          headers: { 'access-control-allow-origin': '*' },
          path: path.join(ROOT, 'node_modules', libraries.get(url.href)),
        });
      }
      if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        return route.fulfill({ contentType: 'text/css', body: '' });
      }
      if (url.origin === ORIGIN) {
        const method = request.method();
        if (url.pathname.startsWith('/api/')) apiRequests.push(`${method} ${url.pathname}`);
        if (method === 'GET' && url.pathname === '/') {
          return route.fulfill({ contentType: 'text/html', body: HTML });
        }
        if (method === 'GET' && url.pathname === '/api/auth/user') return reply({ user: auth.user });
        if (method === 'GET' && url.pathname === '/api/login') {
          return route.fulfill({ contentType: 'text/html', body: '<h1>Intercepted sign-in</h1>' });
        }
        if (url.pathname === '/api/data' && method === 'GET') {
          return reply(auth.dataStatus === 401 ? { error: 'Unauthorized' } : data, auth.dataStatus);
        }
        if (url.pathname === '/api/data' && method === 'POST') {
          data = request.postDataJSON();
          writes.push(structuredClone(data));
          return reply({ success: true });
        }
      }
      // Never continue/fallback: an unknown API or external request must fail closed.
      unexpected.push(`${request.method()} ${url.href}`);
      return route.abort('blockedbyclient');
    });
    await use({
      auth, writes, apiRequests,
      get data() { return data; },
      async open(view = 'dashboard') {
        await page.goto(`${ORIGIN}/#app/${view}`);
        await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
      },
    });
    expect(unexpected, 'All requests must be explicitly intercepted').toEqual([]);
    expect(errors, 'No uncaught browser errors').toEqual([]);
  },
});

module.exports = { test, expect, ORIGIN };
