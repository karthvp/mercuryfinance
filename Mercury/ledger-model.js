/* Shared, integer-cent reconciliation rules. No browser, database or clock dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MercuryLedger = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const OPENING = 'legacy-opening';
  const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const date = s => new Date(`${s}T12:00:00`);
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= '2000-01-01' && s <= '2100-12-31' && dateKey(date(s)) === s;
  function cents(value) {
    const s = String(value).trim();
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) throw new Error('Enter a money amount with no more than two decimal places.');
    const [whole, fraction = ''] = s.replace('-', '').split('.');
    const n = (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (s.startsWith('-') ? -1 : 1);
    if (!Number.isSafeInteger(n) || Math.abs(n) > 1e12) throw new Error('Amount is outside the supported range.');
    return n;
  }
  // Legacy calculations may contain floating point artifacts; normalize only at this boundary.
  const legacyCents = n => cents(Number(n || 0).toFixed(2));
  const money = n => (n / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const ruleKey = (direction, kind, id) => `${direction}:${kind}:${id}`;
  const occurrenceKey = (direction, kind, id, origin) => ruleKey(direction, kind, id) + (kind === 'recurring' ? `:${origin}` : '');
  const accountFor = (o, ledger) => ledger.assignments[o.ruleKey] || OPENING;
  function days(year) {
    const out = [];
    for (let d = new Date(year, 0, 1, 12); d.getFullYear() === year; d.setDate(d.getDate() + 1)) out.push(new Date(d));
    return out;
  }
  function due(d, p, income, year) {
    const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
    const last = new Date(y, m + 1, 0).getDate();
    const weekday = target => {
      const x = new Date(y, m, target, 12);
      while ([0, 6].includes(x.getDay())) x.setDate(x.getDate() - 1);
      return x.getDate();
    };
    if (p.frequency === 'monthly') return day === Math.min(income ? p.startDay : p.dayOfMonth, last);
    if (!income) {
      if (p.frequency === 'weekly') return d.getDay() === p.dayOfWeek;
      if (p.frequency === 'yearly') return m === p.month && day === Math.min(p.day, last);
      return p.frequency === 'semimonthly' && (day === 15 || day === last);
    }
    if (['weekly', 'biweekly'].includes(p.frequency)) {
      const start = new Date(p.startYear || year, 0, p.startDay, 12);
      const delta = Math.round((Date.UTC(y, m, day) - Date.UTC(start.getFullYear(), 0, start.getDate())) / 86400000);
      return delta >= 0 && delta % (p.frequency === 'weekly' ? 7 : 14) === 0;
    }
    // Preserve the existing app's last-weekday-15th behavior for legacy rules.
    if (['semimonthly', 'last-weekday-15th'].includes(p.frequency)) return day === weekday(15) || day === weekday(last);
    return p.frequency === 'last-weekday-eom' && day === weekday(last);
  }
  function debtCutoffs(plan, today) {
    const out = {};
    (plan.debts || []).forEach(d => {
      const linked = (plan.recurringExpenses || []).filter(p => p.debtId != null && String(p.debtId) === String(d.id));
      const monthly = p => p.amount * (p.frequency === 'weekly' ? 52 / 12 : p.frequency === 'semimonthly' ? 2 : p.frequency === 'yearly' ? 1 / 12 : 1);
      const payment = (linked.length ? linked.reduce((sum, p) => sum + monthly(p), 0) : Number(d.monthlyPayment || 0)) + Number(d.extraPayment || 0);
      let balance = d.balance, months = 0;
      const rate = d.apr / 1200;
      if (!payment || payment <= balance * rate) return;
      while (balance > 0 && months < 1200) { balance -= Math.min(payment - balance * rate, balance); months++; }
      if (balance <= 0) {
        const start = date(today);
        out[d.id] = dateKey(new Date(start.getFullYear(), start.getMonth() + months, start.getDate(), 12));
      }
    });
    return out;
  }
  function occurrences(plan, startYear, endYear, today) {
    const out = [], cutoffs = debtCutoffs(plan, today);
    const groups = [
      ['income', 'recurring', plan.payrolls || []],
      ['expense', 'recurring', plan.recurringExpenses || []],
      ['income', 'oneoff', plan.oneOffIncomes || []],
      ['expense', 'oneoff', plan.oneOffExpenses || []],
    ];
    for (let year = Math.max(2000, startYear); year <= Math.min(2100, endYear); year++) {
      groups.forEach(([direction, kind, rules]) => rules.forEach(p => {
        const origins = kind === 'recurring' ? days(year).filter(d => due(d, p, direction === 'income', year)).map(dateKey) : (p.date?.startsWith(String(year)) ? [p.date] : []);
        origins.forEach(origin => {
          if (p.debtId != null && cutoffs[p.debtId] && origin > cutoffs[p.debtId]) return;
          const e = p.exceptions?.[origin] || {};
          out.push({
            key: occurrenceKey(direction, kind, p.id, origin), ruleKey: ruleKey(direction, kind, p.id),
            id: p.id, kind, direction, origin, date: e.moveTo || origin, name: p.name,
            amountCents: legacyCents(e.amount ?? p.amount), skipped: !!e.skip,
          });
        });
      }));
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  }
  // All forecast consumers need the same history, including uncheckpointed accounts.
  // Adoption anchors undated recurring rules; explicit older history can extend it.
  function forecastStartYear(ledger, plan, viewedYear) {
    let first = viewedYear;
    const consider = value => {
      const year = Number(String(value || '').slice(0, 4));
      if (Number.isInteger(year) && year >= 2000 && year <= 2100) first = Math.min(first, year);
    };
    consider(ledger.cutoverDate);
    [...ledger.checkpoints, ...ledger.transactions].forEach(item => consider(item.date));
    Object.keys(plan.initialBalances || {}).forEach(consider);
    Object.keys(plan.balanceOverrides || {}).forEach(consider);
    [...(plan.payrolls || []), ...(plan.recurringExpenses || []), ...(plan.oneOffIncomes || []), ...(plan.oneOffExpenses || [])].forEach(rule => {
      consider(rule.startYear); consider(rule.date);
      Object.entries(rule.exceptions || {}).forEach(([origin, exception]) => { consider(origin); consider(exception.moveTo); });
    });
    return first;
  }
  function nearToday(items, today) {
    return [...items].sort((a, b) => {
      const aPast = a.date < today, bPast = b.date < today;
      if (aPast !== bPast) return aPast ? 1 : -1;
      return aPast ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
    });
  }
  function dateInYear(year, today) {
    return today < `${year}-01-01` ? `${year}-01-01` : today > `${year}-12-31` ? `${year}-12-31` : today;
  }
  function initialLedger(plan, today) {
    const checkpoints = Object.entries(plan.initialBalances || {}).map(([year, amount]) => ({
      id: `opening-${year}`, accountId: OPENING, date: `${year}-01-01`, balanceCents: legacyCents(amount), timing: 'start', source: 'legacy',
    }));
    Object.entries(plan.balanceOverrides || {}).forEach(([day, amount]) => {
      const id = checkpoints.findIndex(c => c.date === day);
      const cp = { id: `checkin-${day}`, accountId: OPENING, date: day, balanceCents: legacyCents(amount), timing: 'start', source: 'legacy' };
      if (id >= 0) checkpoints[id] = cp; else checkpoints.push(cp);
    });
    if (!checkpoints.length) checkpoints.push({ id: 'opening-new', accountId: OPENING, date: `${today.slice(0, 4)}-01-01`, balanceCents: 0, timing: 'start', source: 'legacy' });
    const ledger = {
      schema: 1, cutoverDate: today,
      accounts: [{ id: OPENING, name: 'Opening account', type: 'checking', archived: false }],
      checkpoints, transactions: [], assignments: {}, allocations: [], settlements: [],
    };
    if (!checkpoints.some(c => c.date === today)) {
      const year = Number(today.slice(0, 4));
      const first = Math.min(year, ...checkpoints.map(c => Number(c.date.slice(0, 4))));
      const row = forecast(ledger, occurrences(plan, first, year, today), year, today, OPENING).find(r => r.date === today);
      checkpoints.push({ id: 'adoption-opening', accountId: OPENING, date: today, balanceCents: row.startingCents, timing: 'start', source: 'legacy' });
    }
    return ledger;
  }
  function decorate(o, ledger) {
    const allocatedCents = ledger.allocations.filter(a => a.occurrenceKey === o.key).reduce((sum, a) => sum + a.amountCents, 0);
    const closed = ledger.settlements.some(s => s.occurrenceKey === o.key && s.closed);
    return {
      ...o, accountId: accountFor(o, ledger), allocatedCents, closed,
      remainingCents: o.skipped || closed ? 0 : Math.max(0, o.amountCents - allocatedCents),
      varianceCents: allocatedCents || closed ? allocatedCents - o.amountCents : 0,
      status: o.skipped ? 'Skipped' : closed || allocatedCents >= o.amountCents ? (o.direction === 'income' ? 'Received' : 'Paid') : allocatedCents ? 'Partially settled' : 'Expected',
    };
  }
  function activity(ledger, all, today, accountId) {
    const result = ledger.transactions.filter(t => !accountId || t.accountId === accountId).map(t => ({ ...t, name: t.description, actual: true, kind: 'oneoff' }));
    all.map(o => decorate(o, ledger)).forEach(o => {
      if (o.skipped || (accountId && o.accountId !== accountId)) return;
      const before = o.date < ledger.cutoverDate;
      const amountCents = before
        ? Math.max(0, o.amountCents - (o.closed ? o.amountCents : o.allocatedCents))
        : o.date >= today ? o.remainingCents : 0;
      if (amountCents) result.push({ ...o, amountCents, actual: false });
    });
    return result;
  }
  function forecast(ledger, all, year, today, accountId) {
    const accounts = accountId ? ledger.accounts.filter(a => a.id === accountId) : ledger.accounts;
    const rows = new Map(days(year).map(d => [dateKey(d), { date: dateKey(d), startingCents: 0, endingCents: 0, actualCents: 0, plannedCents: 0, incomeCents: 0, expenseCents: 0, checkpoint: false }]));
    const decorated = all.map(o => decorate(o, ledger));
    accounts.forEach(account => {
      const cps = ledger.checkpoints.filter(c => c.accountId === account.id).sort((a, b) => a.date.localeCompare(b.date));
      let balance = 0;
      const cpMap = new Map(cps.map(c => [c.date, c]));
      const events = new Map();
      const add = (day, field, n) => {
        if (!events.has(day)) events.set(day, { actualCents: 0, plannedCents: 0, incomeCents: 0, expenseCents: 0 });
        events.get(day)[field] += n;
        if (n >= 0) events.get(day).incomeCents += n;
        else events.get(day).expenseCents -= n;
      };
      ledger.transactions.filter(t => t.accountId === account.id).forEach(t => add(t.date, 'actualCents', (t.direction === 'income' ? 1 : -1) * t.amountCents));
      decorated.filter(o => o.accountId === account.id && !o.skipped).forEach(o => {
        // Before adoption retain the historical *plan*, explicitly not a bank-confirmed history.
        // From adoption onward actuals replace history; only outstanding current/future plans project cash.
        const before = o.date < ledger.cutoverDate;
        if (before || o.date >= today) add(o.date, 'plannedCents', (o.direction === 'income' ? 1 : -1) * (before ? o.amountCents : o.remainingCents));
      });
      // A missing checkpoint means a provisional zero *before the earliest activity*,
      // not a fresh zero at the beginning of every requested forecast year.
      let startYear = year;
      for (const date of [...cps.map(c => c.date), ...events.keys()]) startYear = Math.min(startYear, Number(date.slice(0, 4)));
      for (let y = startYear; y <= year; y++) days(y).forEach(d => {
        const day = dateKey(d), cp = cpMap.get(day), event = events.get(day) || { actualCents: 0, plannedCents: 0, incomeCents: 0, expenseCents: 0 };
        if (cp) balance = cp.balanceCents;
        const starting = balance;
        // Actuals before adoption can still be entered: suppress the matching legacy assumption.
        let planned = event.plannedCents;
        if (day < ledger.cutoverDate) {
          decorated.filter(o => o.accountId === account.id && o.date === day && !o.skipped).forEach(o => {
            const suppression = o.closed ? o.amountCents : Math.min(o.amountCents, o.allocatedCents);
            planned -= (o.direction === 'income' ? 1 : -1) * suppression;
            event[o.direction === 'income' ? 'incomeCents' : 'expenseCents'] -= suppression;
          });
        }
        balance += event.actualCents + planned;
        const row = rows.get(day);
        if (row) {
          row.startingCents += starting; row.endingCents += balance;
          row.actualCents += event.actualCents; row.plannedCents += planned; row.checkpoint ||= !!cp;
          row.incomeCents += event.incomeCents; row.expenseCents += event.expenseCents;
        }
      });
    });
    return [...rows.values()];
  }
  function validate(ledger, plan, today, previous) {
    const fail = message => { throw new Error(message); };
    if (!ledger || ledger.schema !== 1 || !validDate(ledger.cutoverDate)) fail('Invalid reconciliation document.');
    if (previous && ledger.cutoverDate !== previous.cutoverDate) fail('The adoption date cannot be changed.');
    for (const k of ['accounts', 'checkpoints', 'transactions', 'allocations', 'settlements']) {
      if (!Array.isArray(ledger[k]) || ledger[k].length > 10000) fail(`Invalid ${k}.`);
    }
    if (ledger.accounts.length > 50 || !ledger.accounts.some(a => a.id === OPENING)) fail('Keep the opening account; at most 50 accounts are supported.');
    if (!ledger.assignments || typeof ledger.assignments !== 'object' || Array.isArray(ledger.assignments)) fail('Invalid account assignments.');
    const text = (s, max = 160) => typeof s === 'string' && s.trim() && s.length <= max;
    const amount = (n, signed = false) => Number.isSafeInteger(n) && Math.abs(n) <= 1e12 && (signed || n > 0);
    for (const k of ['accounts', 'checkpoints', 'transactions', 'allocations']) {
      const ids = new Set();
      ledger[k].forEach(x => { if (!x || !text(x.id) || ids.has(x.id)) fail(`Invalid or duplicate ${k} identifier.`); ids.add(x.id); });
    }
    if (previous && previous.accounts.some(a => !ledger.accounts.some(b => a.id === b.id))) fail('Archive accounts instead of deleting their history.');
    ledger.accounts.forEach(a => { if (!text(a.name, 80) || !['checking', 'savings'].includes(a.type) || typeof a.archived !== 'boolean') fail('Give each account a name and checking/savings type.'); });
    const accounts = new Map(ledger.accounts.map(a => [a.id, a]));
    const cpDates = new Set();
    ledger.checkpoints.forEach(c => {
      if (!accounts.has(c.accountId) || !validDate(c.date) || !amount(c.balanceCents, true) || c.timing !== 'start' || !['legacy', 'manual'].includes(c.source)) fail('Invalid start-of-day checkpoint.');
      const unchangedLegacy = previous?.checkpoints.some(p => JSON.stringify(p) === JSON.stringify(c) && c.source === 'legacy');
      if (c.source === 'legacy' && !unchangedLegacy && previous) fail('New or edited checkpoints must be manual.');
      if (c.date > today && !unchangedLegacy) fail('A recorded balance cannot be in the future.');
      const key = `${c.accountId}:${c.date}`;
      if (cpDates.has(key)) fail('Only one start-of-day checkpoint per account and date.'); cpDates.add(key);
    });
    ledger.transactions.forEach(t => {
      if (!accounts.has(t.accountId) || !validDate(t.date) || t.date > today || !['income', 'expense'].includes(t.direction) || !amount(t.amountCents) || !text(t.description)) fail('Invalid actual transaction. Use a positive amount, description and date no later than today.');
      const before = previous?.transactions.find(p => p.id === t.id);
      if (accounts.get(t.accountId).archived && (!before || before.accountId !== t.accountId)) fail('Restore the account before adding activity.');
    });
    const all = occurrences(plan, 2000, 2100, today), occ = new Map(all.map(o => [o.key, o])), rules = new Set(all.map(o => o.ruleKey));
    Object.entries(ledger.assignments).forEach(([key, id]) => {
      if (!accounts.has(id)) fail('Unknown assigned account.');
      if (!rules.has(key) && !previous?.assignments[key]) fail('Unknown planned entry.');
      if (accounts.get(id).archived && previous?.assignments[key] !== id) fail('Restore the account before assigning plans.');
    });
    const totals = new Map(), transactions = new Map(ledger.transactions.map(t => [t.id, t]));
    ledger.allocations.forEach(a => {
      const t = transactions.get(a.transactionId), o = occ.get(a.occurrenceKey);
      if (!t || !o || o.skipped || !amount(a.amountCents)) fail('A match must reference an existing transaction and an active planned occurrence.');
      if (t.direction !== o.direction || t.accountId !== accountFor(o, ledger)) fail('Match deposits to income and outflows to expenses in the same account.');
      totals.set(t.id, (totals.get(t.id) || 0) + a.amountCents);
      if (totals.get(t.id) > t.amountCents) fail('Matches cannot allocate more than the actual transaction amount.');
    });
    const settled = new Set();
    ledger.settlements.forEach(s => {
      if (!s || !occ.has(s.occurrenceKey) || s.closed !== true || settled.has(s.occurrenceKey)) fail('Invalid or duplicate completed occurrence.');
      if (!ledger.allocations.some(a => a.occurrenceKey === s.occurrenceKey)) fail('Match an actual transaction before completing an occurrence.');
      settled.add(s.occurrenceKey);
    });
    return true;
  }
  return { OPENING, cents, money, validDate, dateKey, ruleKey, occurrenceKey, occurrences, forecastStartYear, nearToday, dateInYear, initialLedger, decorate, activity, forecast, validate };
});
