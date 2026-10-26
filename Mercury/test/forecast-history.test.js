const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../ledger-model');

test('shared forecast window preserves assigned plans and actuals multiple years before the viewed year', () => {
  const today = '2026-06-15';
  const plan = { initialBalances: {}, payrolls: [{ id: 'salary', name: 'Salary', amount: 100, frequency: 'monthly', startDay: 1, startYear: 2026 }], recurringExpenses: [], oneOffIncomes: [], oneOffExpenses: [] };
  const ledger = {
    schema: 1, cutoverDate: today,
    accounts: [{ id: m.OPENING, name: 'Opening', type: 'checking', archived: false }, { id: 'checking', name: 'Checking', type: 'checking', archived: false }],
    checkpoints: [{ id: 'future-opening', accountId: m.OPENING, date: '2027-01-01', balanceCents: 0, timing: 'start', source: 'legacy' }],
    transactions: [{ id: 'deposit', accountId: 'checking', date: today, direction: 'income', amountCents: 2500, description: 'Deposit' }],
    allocations: [], settlements: [], assignments: { 'income:recurring:salary': 'checking' },
  };
  const start = m.forecastStartYear(ledger, plan, 2028);
  assert.equal(start, 2026);
  const all = m.occurrences(plan, start, 2029, today);
  const result = m.forecast(ledger, all, 2028, today, 'checking');
  // Full 2026 and 2027 plan (legacy assumptions before adoption), plus the actual deposit.
  assert.equal(result[0].startingCents, 242500);
  assert.equal(result[0].endingCents, 252500, 'January paycheck is applied exactly once');
  const next = m.forecast(ledger, m.occurrences(plan, m.forecastStartYear(ledger, plan, 2029), 2030, today), 2029, today, 'checking');
  assert.equal(next[0].startingCents, result.at(-1).endingCents);
  const earlyMatch = { id: 'early', transactionId: 'deposit', occurrenceKey: 'income:recurring:salary:2026-07-01', amountCents: 2500 };
  ledger.allocations.push(earlyMatch);
  assert.equal(m.forecast(ledger, all, 2028, today, 'checking')[0].startingCents, 240000, 'early matched deposit replaces that part of the future plan');
});

test('older actuals, dated rules, exceptions and legacy balances extend the shared history without a checkpoint', () => {
  const ledger = { cutoverDate: '2026-06-15', checkpoints: [], transactions: [{ date: '2024-01-01' }] };
  const plan = { payrolls: [{ startYear: 2023, exceptions: { '2021-12-31': { moveTo: '2022-01-01' } } }], initialBalances: { 2020: 0 }, balanceOverrides: { '2019-04-03': 0 }, oneOffExpenses: [{ date: '2018-02-01' }] };
  assert.equal(m.forecastStartYear(ledger, plan, 2028), 2018);
  assert.equal(m.forecastStartYear({ cutoverDate: '2026-01-01', checkpoints: [], transactions: [] }, {}, 2028), 2026);
});
test('near-today order preserves history, prioritizes upcoming dates and never mutates saved records', () => {
  const input = [{ date: '2026-01-01' }, { date: '2026-06-20' }, { date: '2026-06-15' }, { date: '2026-06-14' }];
  const copy = structuredClone(input);
  assert.deepEqual(m.nearToday(input, '2026-06-15').map(d => d.date), ['2026-06-15', '2026-06-20', '2026-06-14', '2026-01-01']);
  assert.deepEqual(input, copy);
  assert.equal(m.dateInYear(2026, '2026-06-15'), '2026-06-15');
  assert.equal(m.dateInYear(2025, '2026-06-15'), '2025-12-31');
  assert.equal(m.dateInYear(2027, '2026-06-15'), '2027-01-01');
});
