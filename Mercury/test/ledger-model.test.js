const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../ledger-model');
const today = '2026-10-20';
const plan = () => ({ initialBalances: { 2026: 500 }, balanceOverrides: {}, payrolls: [], recurringExpenses: [], oneOffExpenses: [], oneOffIncomes: [{ id: 'pay', name: 'Paycheck', amount: 100, date: today }], debts: [] });
const all = p => m.occurrences(p, 2025, 2027, today);
const clone = x => JSON.parse(JSON.stringify(x));
const transaction = (id, amountCents, direction = 'income', day = today, accountId = m.OPENING) => ({ id, amountCents, direction, date: day, accountId, description: id });
const row = (l, p, day = today, account) => m.forecast(l, all(p), 2026, today, account).find(r => r.date === day);

test('money uses exact cents and rejects hidden rounding and unsafe values', () => {
  assert.equal(m.cents('123.45'), 12345);
  assert.equal(m.cents('-0.01'), -1);
  assert.equal(m.money(-120075), '-$1,200.75');
  for (const value of ['1.001', 'NaN', 'Infinity', '', '1e3', '1000000000000000']) assert.throws(() => m.cents(value));
});
test('legacy adoption is non-destructive and preserves prior projected history and zero balances', () => {
  const p = plan(); p.oneOffIncomes.push({ id: 'earlier', name: 'Prior plan', amount: 20.25, date: '2026-03-01' });
  p.oneOffExpenses.push({ id: 'bill', name: 'Prior bill', amount: 15, date: '2026-03-02' });
  const before = clone(p), l = m.initialLedger(p, today);
  assert.deepEqual(p, before);
  assert.equal(l.checkpoints.find(c => c.id === 'adoption-opening').balanceCents, 50525);
  assert.equal(l.transactions.length, 0);
  assert.equal(row(l, p).endingCents, 60525);
  p.initialBalances[2026] = 0;
  assert.equal(m.initialLedger(p, today).checkpoints.find(c => c.id === 'opening-2026').balanceCents, 0);
});
test('partial and combined deposits settle one occurrence without double counting', () => {
  const p = plan(), previous = m.initialLedger(p, today), l = clone(previous), o = all(p)[0];
  l.transactions = [transaction('part-a', 4000), transaction('part-b', 5000)];
  l.allocations = [{ id: 'a', transactionId: 'part-a', occurrenceKey: o.key, amountCents: 4000 }, { id: 'b', transactionId: 'part-b', occurrenceKey: o.key, amountCents: 5000 }];
  m.validate(l, p, today, previous);
  assert.equal(m.decorate(o, l).status, 'Partially settled');
  assert.equal(m.decorate(o, l).remainingCents, 1000);
  assert.equal(row(l, p).endingCents, 60000);
  l.settlements = [{ occurrenceKey: o.key, closed: true }];
  assert.equal(m.decorate(o, l).status, 'Received');
  assert.equal(m.decorate(o, l).varianceCents, -1000);
  assert.equal(row(l, p).endingCents, 59000);
  assert.equal(m.activity(l, all(p), today).reduce((sum, a) => sum + a.amountCents, 0), 9000);
});
test('an early actual included by a later checkpoint is not applied again', () => {
  const p = plan(), l = m.initialLedger(p, today), o = all(p)[0];
  l.transactions = [transaction('early', 10000, 'income', '2026-10-19')];
  l.allocations = [{ id: 'match', transactionId: 'early', occurrenceKey: o.key, amountCents: 10000 }];
  l.checkpoints = [{ id: 'verified', accountId: m.OPENING, date: today, balanceCents: 75000, timing: 'start', source: 'manual' }];
  assert.equal(row(l, p).endingCents, 75000);
  l.transactions[0].date = today;
  assert.equal(row(l, p).endingCents, 85000, 'same-day transactions follow start-of-day checkpoint');
});
test('late bills affect their actual day and unreviewed overdue plans remain explicit', () => {
  const p = plan(); p.oneOffIncomes = [];
  p.oneOffExpenses = [{ id: 'rent', name: 'Rent', amount: 100, date: '2026-10-19' }];
  const l = m.initialLedger(p, '2026-10-18'), o = all(p)[0];
  assert.equal(m.decorate(o, l).status, 'Expected');
  assert.equal(m.decorate(o, l).remainingCents, 10000);
  l.transactions = [transaction('late', 10000, 'expense')];
  l.allocations = [{ id: 'match', transactionId: 'late', occurrenceKey: o.key, amountCents: 10000 }];
  assert.equal(row(l, p).endingCents, 40000);
  assert.equal(m.decorate(o, l).status, 'Paid');
});
test('checking shortfall is visible even when aggregate savings is positive; archived history remains', () => {
  const p = plan(); p.oneOffIncomes = []; p.oneOffExpenses = [{ id: 'bill', name: 'Bill', amount: 600, date: today }];
  const l = m.initialLedger(p, today);
  l.accounts.push({ id: 'savings', name: 'Savings', type: 'savings', archived: true });
  l.checkpoints.push({ id: 'savings-cp', accountId: 'savings', date: today, balanceCents: 100000, timing: 'start', source: 'manual' });
  assert.equal(row(l, p, today, m.OPENING).endingCents, -10000);
  assert.equal(row(l, p).endingCents, 90000);
});
test('overlapping checkpoints rebase independently and later years carry forward', () => {
  const p = plan(), l = m.initialLedger(p, today);
  l.checkpoints = [
    { id: 'first', accountId: m.OPENING, date: '2026-01-01', balanceCents: 50000, timing: 'start', source: 'manual' },
    { id: 'next', accountId: m.OPENING, date: today, balanceCents: 30000, timing: 'start', source: 'manual' },
  ];
  assert.equal(row(l, p).endingCents, 40000);
  assert.equal(m.forecast(l, all(p), 2027, today)[0].startingCents, 40000);
});
test('accounts without checkpoints carry earlier actuals into every subsequent forecast year', () => {
  const p = plan(), l = m.initialLedger(p, today);
  l.accounts.push({ id: 'new-checking', name: 'New checking', type: 'checking', archived: false });
  l.transactions = [
    transaction('old-income', 25000, 'income', '2024-12-20', 'new-checking'),
    transaction('old-expense', 5000, 'expense', '2026-01-02', 'new-checking'),
  ];
  for (const year of [2026, 2027, 2028]) {
    const result = m.forecast(l, all(p), year, today, 'new-checking');
    assert.equal(result[0].startingCents, year === 2026 ? 25000 : 20000, `prior actuals carry into ${year}`);
    assert.equal(result.at(-1).endingCents, 20000);
  }
  l.checkpoints.push({ id: 'later-cp', accountId: 'new-checking', date: '2028-01-01', balanceCents: 30000, timing: 'start', source: 'manual' });
  assert.equal(m.forecast(l, all(p), 2027, today, 'new-checking')[0].startingCents, 20000, 'a later checkpoint does not hide earlier account history');
  assert.equal(m.forecast(l, all(p), 2028, today, 'new-checking')[0].startingCents, 30000, 'the explicit checkpoint rebases history when reached');
});
test('same-amount candidates are never automatically matched and allocation capacity is enforced', () => {
  const p = plan(), before = m.initialLedger(p, today), l = clone(before), o = all(p)[0];
  l.transactions = [transaction('first', 10000), transaction('second', 10000)];
  assert.equal(m.decorate(o, l).allocatedCents, 0);
  l.allocations = [{ id: 'a', transactionId: 'first', occurrenceKey: o.key, amountCents: 6000 }, { id: 'b', transactionId: 'first', occurrenceKey: o.key, amountCents: 5000 }];
  assert.throws(() => m.validate(l, p, today, before), /more than/);
  l.allocations.pop();
  m.validate(l, p, today, before);
});
test('direction, account, archive, missing references, future dates, and duplicate checkpoints are validated', () => {
  const p = plan(), before = m.initialLedger(p, today), o = all(p)[0];
  const attempt = edit => { const l = clone(before); l.transactions = [transaction('tx', 10000)]; l.allocations = [{ id: 'a', transactionId: 'tx', occurrenceKey: o.key, amountCents: 10000 }]; edit(l); return () => m.validate(l, p, today, before); };
  assert.throws(attempt(l => { l.transactions[0].direction = 'expense'; }), /same account/);
  assert.throws(attempt(l => { l.transactions[0].date = '2026-10-21'; }), /date no later/);
  assert.throws(attempt(l => { l.transactions[0].date = '2026-02-30'; }), /Invalid actual/);
  assert.throws(attempt(l => { l.transactions = []; }), /existing transaction/);
  assert.throws(attempt(l => { l.accounts[0].archived = true; }), /Restore/);
  assert.throws(attempt(l => { l.checkpoints.push({ ...l.checkpoints[0], id: 'duplicate', source: 'manual' }); }), /one start/);
});
test('per-occurrence moves/skips and debt-linked stopping preserve calendar identity', () => {
  const p = plan(); p.oneOffIncomes = [];
  p.payrolls = [{ id: 1, name: 'Salary', amount: 100, frequency: 'monthly', startDay: 31, exceptions: { '2026-02-28': { moveTo: '2026-03-01', amount: 90 }, '2026-03-31': { skip: true } } }];
  const list = all(p);
  const moved = list.find(o => o.origin === '2026-02-28');
  assert.equal(moved.date, '2026-03-01');
  assert.equal(moved.amountCents, 9000);
  assert.equal(moved.key, 'income:recurring:1:2026-02-28');
  const skipped = list.find(o => o.origin === '2026-03-31');
  assert.equal(m.decorate(skipped, m.initialLedger(p, today)).status, 'Skipped');
  p.debts = [{ id: 'loan', balance: 100, apr: 0, monthlyPayment: 100 }];
  p.recurringExpenses = [{ id: 'payment', name: 'Payment', amount: 100, frequency: 'monthly', dayOfMonth: 1, debtId: 'loan' }];
  assert.ok(!all(p).some(o => o.id === 'payment' && o.date > '2026-11-20'));
});
test('undo reopens remaining plan and corrected transactions affect the forecast exactly once', () => {
  const p = plan(), l = m.initialLedger(p, today), o = all(p)[0];
  l.transactions = [transaction('tx', 10000)];
  l.allocations = [{ id: 'a', transactionId: 'tx', occurrenceKey: o.key, amountCents: 10000 }];
  assert.equal(row(l, p).endingCents, 60000);
  l.allocations = []; l.transactions[0].amountCents = 7500;
  assert.equal(m.decorate(o, l).status, 'Expected');
  assert.equal(row(l, p).endingCents, 67500, 'unmatched actual is separate from the unconfirmed planned deposit');
  l.allocations = [{ id: 'b', transactionId: 'tx', occurrenceKey: o.key, amountCents: 7500 }];
  assert.equal(row(l, p).endingCents, 60000);
});
