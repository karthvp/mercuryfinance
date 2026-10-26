const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const handlerBody = html.match(/const clearCheckInsForYear = \(year\) => \{([\s\S]*?)\n      \};/)[1];

test('Dashboard checkpoint management opens the revisioned account controls instead of silently clearing legacy data', () => {
  let destination, legacyChanged = false, prompted = false;
  const handler = vm.runInNewContext(`(year) => { ${handlerBody} }`, {
    ledgerState: { revision: 3, ledger: { checkpoints: [] } },
    setActiveView: view => { destination = view; },
    setBalanceOverrides: () => { legacyChanged = true; },
    confirm: () => { prompted = true; return true; },
  });
  handler(2026);
  assert.equal(destination, 'accounts');
  assert.equal(legacyChanged, false);
  assert.equal(prompted, false, 'does not promise a deletion which will not happen');
  assert.match(html, /onClick=\{\(\) => clearCheckInsForYear\(dashboardYear\)\}>\{ledgerState \? 'Manage account checkpoints' : 'Clear legacy check-ins'\}/);
  assert.match(html, /Imported legacy checkpoints are[\s\S]*?estimates, not verified actual balances/);
  assert.doesNotMatch(html, /Actual balance recorded/);
});
test('legacy-only checkpoint removal remains confirmed and restricted to the selected year', () => {
  let overrides = { '2025-01-01': 100, '2026-03-01': 200 };
  const handler = vm.runInNewContext(`(year) => { ${handlerBody} }`, {
    ledgerState: null,
    setBalanceOverrides: callback => { overrides = callback(overrides); },
    confirm: () => true,
  });
  handler(2026);
  assert.deepEqual(Object.entries(overrides), [['2025-01-01', 100]]);
});
