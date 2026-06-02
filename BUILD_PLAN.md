# BUILD_PLAN.md — Debt Payoff Planner (recurring-integrated) + Year Rollover

Status: **Phase 1 — awaiting approval.** No feature code written yet.

---

## Phase 0 — Discovery (current architecture, as on `main`)

**Files:** `Mercury/index.html` (3161 lines, one `<script type="text/babel">`, Babel-in-browser), `Mercury/index.js` (471 lines, Express + `pg`).

**State / derivation / save–load lifecycle (`FinancialTracker`):**
- State: `initialBalances`, `payrolls`, `recurringExpenses`, `oneOffExpenses`, `oneOffIncomes`, `balanceOverrides`, `archivedYears`, `activeYear`, `dashboardYear`, `activeView`, plus form/loading state.
- **Load** (mount `useEffect`, ~L1644): `api.loadData()` → `if (data.X) setX(...)` per field; `currentYear` → `setActiveYear`+`setDashboardYear`; then `setIsLoading(false)`.
- **Save** (`saveToServer` useCallback ~L1671): debounced 500 ms; builds `{version: DATA_VERSION, initialBalances, payrolls, recurringExpenses, oneOffExpenses, oneOffIncomes, balanceOverrides, currentYear: activeYear, archivedYears}` → `POST /api/data`. A `useEffect` fires it whenever any of those state vars change. **Any new state must be added to BOTH the load hydration and the save payload + its dep arrays.**
- `DATA_VERSION = 1` (frontend const, L703).

**⚠️ Derivation engine — deviates from the prompt's "three call sites":** the mechanics rework consolidated everything into one engine:
- `generateOccurrences(year, payrolls, recurringExpenses, oneOffExpenses, oneOffIncomes)` (L890) → `{ incomeByDate, expenseByDate }`. **`isExpenseDue` (L858) and `isPayday` (L817) are each called exactly once here.**
- `buildYearSeries(year, occ, initialBalance, balanceOverrides, today, todayKey)` (L924) → daily series; Dec 31 ending = `endingBalance` of the last entry.
- Callers of `generateOccurrences`: `activeOccurrences` (L1712 → `financialData`), `dashboardSeries` recompute for non-active years (L1726), `dashboardOccurrences` (L1838 → `stats`/`forecast`/`ytdExpensesByName`/`sankeyData`).
- **Consequence:** the debt-termination rule belongs **inside `generateOccurrences`** (one integration point), threaded to its callers — Calendar, Dashboard, and Cash Flow can't drift because they all read from this function.

**Recurring-expense form + list:** form via `useReducer` (`formState.recurring`); `addRecurringExpense`/`editRecurringExpense` use an `upsert` helper; rendered in the dashboard "Income & Expenses" panels with edit/delete + drag. Form fields: name, amount, frequency, day-of-month/week/month+day.

**Nav / view switching / hash routing:** `activeView ∈ {dashboard, cashflow, calendar}`; `getInitialActiveView` (L1520) reads `location.hash`; `setActiveView` (L1528) sets state + `history.replaceState('#app/'+view)`; a `hashchange` `useEffect` (L1535) maps hash→view; nav buttons (L3016); render switch (L3035). `AppShell.changeView` (~L3110) also derives a subView from the hash.

**Year management:** `realCurrentYear = getCurrentYear()`; `activeYear`/`dashboardYear` state; `archivedYears: number[]`; `availableYears = useMemo(unique([activeYear, ...archivedYears]).desc)` (L1706); `initialBalances: {year:number}` (default 5000); persisted `currentYear = activeYear`. Year `<select>`s at L2589/L2759; `updateInitialBalance` (L2466).

**Backend anchors (`index.js`):** `CREATE TABLE mercury_data` (L44, JSONB cols); existing `ALTER TABLE ... ADD COLUMN IF NOT EXISTS one_off_incomes` (L63) — the migration pattern to copy; GET row→JSON map with `|| []` defaults (L~340); POST `INSERT ... ON CONFLICT` column list + params (L371); PATCH `updateQueries` map (L412); `validators` (L255–272). `isValidRecurringExpense` (L255) checks only name/amount/frequency and **ignores extra fields** (so `debtId` already passes; we'll add an explicit optional check anyway).

---

## Shared design (used by both features)

### Termination helper — single integration point
Per Section 4, but adapted to the real engine. Add a pure helper and thread a payoff map:
```
isRecurringActiveOn(dateKey, expense, payoffDateByDebtId)
  = (!expense.debtId)
    || !payoffDateByDebtId[expense.debtId]   // unknown / never-pays → always active
    || dateKey <= payoffDateByDebtId[expense.debtId];
```
- `generateOccurrences` gains a 6th param `payoffDateByDebtId = {}`. In the `recurringExpenses` loop, after computing the natural `origin` dateKey, `if (!isRecurringActiveOn(origin, x, payoffDateByDebtId)) return;` (use the **natural origin** for the cutoff so per-occurrence moves don't change termination).
- Thread `payoffDateByDebtId` through the three `generateOccurrences` callers.
- **No circular memo:** `debtPlan` is computed from `debts` + `recurringExpenses` only (never from `financialData`), so the chain is `debtPlan → payoffDateByDebtId → generateOccurrences → financialData`.

### Pure helpers (module-level, unit-testable)
- `monthlyEquivalent(expense)`: weekly → `amount*52/12`, monthly → `amount`, yearly → `amount/12`.
- `effectivePaymentForDebt(debt, recurringExpenses)`: sum `monthlyEquivalent` of linked expenses, else `debt.monthlyPayment`, plus `extraPayment||0`; `null` if neither.
- `amortize(balance, apr, payment)` → `{ months, totalInterest, totalPaid, neverPays }`. Headline months = closed form (`r=0`→`ceil(bal/P)`; `P>=bal`→1; `P<=bal*r`→neverPays); interest + final partial payment from a month-by-month loop **capped at 1200**.
- `payoffDateKeyFrom(today, months)` = `toDateKey(new Date(y, m+months, d))` (whole-month granularity; never `toISOString`).
- `computeDebtPlan(debts, recurringExpenses, today)` → per-debt result + `payoffDateByDebtId` (omit entries that never pay / unknown).

---

## Work Order A — Debt Payoff Planner  (branch `feature/debt-planner`)

**A1 · Backend persistence (`index.js`)** — all six steps of Section 2.3:
`debts JSONB DEFAULT '[]'` in CREATE TABLE; `ADD COLUMN IF NOT EXISTS debts`; GET `debts: row.debts || []` (+ empty-row default); POST column list/ON-CONFLICT/params; PATCH `updateQueries['debts']`; `isValidDebt` + call in `isValidFinancialData`; add optional `debtId` check (string|number) to `isValidRecurringExpense`.

**A2 · Frontend state + persistence**
`const [debts, setDebts] = useState([])`; hydrate in `loadData` (default `[]`); add to `saveToServer` payload + both dep arrays; **bump `DATA_VERSION` → 2**.

**A3 · Engine integration**
Add the pure helpers; `debtPlan = useMemo(…, [debts, recurringExpenses])`; extend `generateOccurrences` with `payoffDateByDebtId` + `isRecurringActiveOn`; thread through the 3 callers.

**A4 · Handlers + referential integrity**
`addDebt`/`editDebt`/`deleteDebt` (upsert). `deleteDebt` clears `debtId` on referencing `recurringExpenses`. Recurring form/handlers carry optional `debtId`.

**A5 · UI**
`Icons.Debt`; new **Debt** nav tab; hash routing `#app/debt` (initial resolver + `hashchange` + `AppShell` subView); `renderDebt()`: aggregate `StatCard`s (total debt, total monthly debt payment, weighted-avg APR = `Σ(bal*apr)/Σbal`, latest payoff), debt list (`ItemRow` style: balance, APR, effective payment, linked payment name(s), payoff date, total interest, progress bar) with add/edit/delete; add/edit `FormOverlay`; warning token when no payment source / never pays. Recurring list gets a "linked" badge.

**A6 · Acceptance** — Section 4 criteria, incl. **$5,000 @ 20% APR + $200/mo ≈ 32 months / ≈ $1,312 interest**; linked expense disappears from Calendar after payoff **and** the same termination shows in Dashboard `stats` and the Sankey (no drift); underpayment warns + never hangs + never terminates; 0% / P≥balance handled; delete degrades gracefully; full round-trip.

---

## Work Order B — Year Rollover  (branch `feature/year-rollover`, after A merges)

**B1 · Logic** — `rollForwardYears(...)` pure-ish: while `realCurrentYear > currentYear`, for each completed `y`: compute its **Dec 31 ending** via `buildYearSeries(y, generateOccurrences(y, …, payoffDateByDebtId), initialBalances[y]||5000, balanceOverrides, today, todayKey)` last entry; `initialBalances[y+1]` set **only if undefined**; add `y` to `archivedYears` if absent; advance `currentYear`/`activeYear`. Idempotent; handles multi-year gaps.

**B2 · State/persist** — runs on load after hydration; mutates `initialBalances`/`archivedYears`/`activeYear` (already in autosave deps) → flows through normal autosave. Idempotent so it won't loop.

**B3 · UI** — dismissible banner (existing token styles) summarizing the rollover; manual **"Roll over to &lt;year&gt;"** action reusing the same logic.

**B4 · Acceptance** — Section 5: simulate `realCurrentYear+1` archives + carries Dec 31→Jan 1; idempotent; preset `initialBalances[next]` preserved; 2-year gap rolls each year; archived years stay viewable.

---

## Verification (Section 6)
`node Mercury/index.js` boots; data round-trips across reload; **DATA_VERSION migration** verified by loading an old-shaped payload (no `debts`, recurring without `debtId`); projected year-end == last day's ending balance. Plus optional `Mercury/scripts/*.js` plain-`node` asserts for amortization, linked-expense termination, and rollover math on fixtures (no test runner).

## Open decisions to confirm
1. **Payoff granularity:** whole months from *today* (cutoff = `payoffDateKey`, expense active while `origin <= payoffDateKey`). OK?
2. **Manual rollover placement:** in the dashboard year-selector row vs a small header action. Preference?
3. **Extra payment** is per-debt (not per-linked-expense). OK?
