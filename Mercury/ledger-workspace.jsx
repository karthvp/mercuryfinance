window.LedgerWorkspace = function LedgerWorkspace({ ledger, plan, year, today, onSave, onRefresh, busy, error }) {
  const { useState, useMemo, useEffect, useRef } = React;
  const h = React.createElement;
  const [panel, setPanel] = useState("");
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [accountFilter, setAccountFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: "", type: "checking" });
  const [checkpointForm, setCheckpointForm] = useState({ accountId: "", date: today || "", balance: "" });
  const [transactionForm, setTransactionForm] = useState({ accountId: "", date: today || "", direction: "expense", amount: "", description: "" });
  const [allocationForm, setAllocationForm] = useState({});
  const [planLimit, setPlanLimit] = useState(12);
  const [actualLimit, setActualLimit] = useState(12);
  const [overdueLimit, setOverdueLimit] = useState(5);
  const [checkpointLimit, setCheckpointLimit] = useState(5);
  const forecastListRef = useRef(null);

  const api = window.MercuryLedger;
  const data = ledger || { schema: 1, cutoverDate: today, accounts: [], checkpoints: [], transactions: [], assignments: {}, allocations: [], settlements: [] };
  const accounts = data.accounts || [];
  const activeAccounts = accounts.filter(a => !a.archived);
  const chosenAccount = accountFilter === "all" ? undefined : accountFilter;
  const calculation = useMemo(() => {
    try {
      if (!api || !plan) throw new Error("The forecast engine is unavailable. Reload before making changes.");
      const all = api.occurrences(plan, api.forecastStartYear(data, plan, Number(year)), Number(year) + 1, today || "");
      return {
        decorated: all.map(o => api.decorate(o, data)),
        forecast: api.forecast(data, all, Number(year), today || "", chosenAccount),
        accountRisks: accounts.map(account => ({ account, shortfall: api.forecast(data, all, Number(year), today || "", account.id).find(f => f.date >= today && f.endingCents < 0) })).filter(r => r.shortfall),
      };
    } catch (error) { return { decorated: [], forecast: [], accountRisks: [], error: error.message }; }
  }, [api, plan, year, today, data, chosenAccount]);
  const { decorated, forecast } = calculation;
  const yearsOccurrences = decorated.filter(o => String(o.date || "").slice(0, 4) === String(year));
  const nextShortfall = chosenAccount ? forecast.find(f => Number(f.endingCents) < 0 && f.date >= today) : null;
  const accountName = id => accounts.find(a => a.id === id)?.name || "Unassigned";
  const accountChoices = selected => [
    ...activeAccounts,
    ...accounts.filter(a => a.archived && a.id === selected)
  ].map(a => ({ value: a.id, label: `${a.name}${a.archived ? " · archived (existing)" : ""}` }));
  const money = cents => api.money(cents);
  const dateText = date => {
    if (!date) return "No date";
    const d = new Date(date + "T12:00:00");
    return Number.isNaN(+d) ? date : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };
  const ruleKey = o => o.ruleKey || api?.ruleKey(o.direction, o.kind, o.id);
  const setNotice = text => { setMessage(text); window.setTimeout(() => setMessage(""), 4500); };
  const save = async next => {
    setSaving(true); setMessage("");
    try {
      const ok = await onSave(next);
      if (ok) { setPanel(""); setEditing(null); setNotice("Saved. Your ledger is up to date."); }
      else setNotice("That didn’t save. Your changes are still here—try again or reload the latest ledger.");
      return !!ok;
    } catch (e) { setNotice(e?.message || "That didn’t save. Please try again."); return false; }
    finally { setSaving(false); }
  };
  const refreshLatest = async () => {
    try { await onRefresh?.(); setNotice("Reloaded the latest ledger."); }
    catch (e) { setNotice(e?.message || "Couldn’t reload the latest ledger. Try again."); }
  };
  const update = (key, value) => save({ ...data, [key]: value });
  const startAccount = account => {
    setEditing(account || null);
    setAccountForm(account ? { name: account.name, type: account.type } : { name: "", type: "checking" });
    setPanel("account");
  };
  const submitAccount = async e => {
    e.preventDefault();
    const name = accountForm.name.trim();
    if (!name) return setNotice("Add an account name first.");
    const nextAccounts = [...accounts];
    if (editing) {
      const i = nextAccounts.findIndex(a => a.id === editing.id);
      if (i >= 0) nextAccounts[i] = { ...nextAccounts[i], name, type: accountForm.type };
    } else nextAccounts.push({ id: crypto.randomUUID(), name, type: accountForm.type, archived: false });
    await save({ ...data, accounts: nextAccounts });
  };
  const archiveAccount = async account => {
    if (account.id === "legacy-opening") return setNotice("The original opening account stays in your ledger.");
    await update("accounts", accounts.map(a => a.id === account.id ? { ...a, archived: !a.archived } : a));
  };
  const startCheckpoint = checkpoint => {
    setEditing(checkpoint || null);
    setCheckpointForm(checkpoint
      ? { accountId: checkpoint.accountId, date: checkpoint.date, balance: (checkpoint.balanceCents / 100).toFixed(2) }
      : { accountId: activeAccounts[0]?.id || "", date: today || "", balance: "" });
    setPanel("checkpoint");
  };
  const submitCheckpoint = async e => {
    e.preventDefault();
    try {
      if (!checkpointForm.accountId || !checkpointForm.date || checkpointForm.date > today) throw new Error("Choose an account and a date no later than today.");
      const balanceCents = api.cents(checkpointForm.balance);
      if (data.checkpoints.some(c => c.accountId === checkpointForm.accountId && c.date === checkpointForm.date && c.id !== editing?.id)) throw new Error("There’s already a starting balance for this account on that date.");
      const item = { id: editing?.id || crypto.randomUUID(), accountId: checkpointForm.accountId, date: checkpointForm.date, balanceCents, timing: "start", source: "manual" };
      const checkpoints = editing ? data.checkpoints.map(c => c.id === editing.id ? item : c) : [...(data.checkpoints || []), item];
      await update("checkpoints", checkpoints);
    } catch (e) { setNotice(e.message || "Enter a valid balance."); }
  };
  const startTransaction = transaction => {
    setEditing(transaction || null);
    setTransactionForm(transaction
      ? { accountId: transaction.accountId, date: transaction.date, direction: transaction.direction, amount: (transaction.amountCents / 100).toFixed(2), description: transaction.description }
      : { accountId: activeAccounts[0]?.id || "", date: today || "", direction: "expense", amount: "", description: "" });
    setPanel("transaction");
  };
  const submitTransaction = async e => {
    e.preventDefault();
    try {
      if (!transactionForm.accountId || !transactionForm.date || transactionForm.date > today) throw new Error("Choose an account and a date no later than today.");
      const amountCents = api.cents(transactionForm.amount);
      if (amountCents <= 0) throw new Error("Amount must be greater than zero.");
      if (editing && (editing.accountId !== transactionForm.accountId || editing.direction !== transactionForm.direction || editing.amountCents !== amountCents)) {
        const linked = (data.allocations || []).some(a => a.transactionId === editing.id);
        if (linked && !window.confirm("This transaction has matches. Unmatch it first before changing its account, direction, or amount.")) return;
        if (linked) return setNotice("Unmatch this transaction’s allocations first, then edit it.");
      }
      const item = { id: editing?.id || crypto.randomUUID(), accountId: transactionForm.accountId, date: transactionForm.date, direction: transactionForm.direction, amountCents, description: transactionForm.description.trim() };
      const transactions = editing ? data.transactions.map(t => t.id === editing.id ? item : t) : [...(data.transactions || []), item];
      await update("transactions", transactions);
    } catch (e) { setNotice(e.message || "Enter a valid transaction amount."); }
  };
  const deleteTransaction = async t => {
    const linked = (data.allocations || []).filter(a => a.transactionId === t.id);
    if (!window.confirm(`Delete “${t.description || "this transaction"}”? This also removes ${linked.length} allocation${linked.length === 1 ? "" : "s"}.`)) return;
    const allocations = (data.allocations || []).filter(a => a.transactionId !== t.id);
    await save({ ...data, transactions: data.transactions.filter(x => x.id !== t.id), allocations, settlements: data.settlements.filter(s => allocations.some(a => a.occurrenceKey === s.occurrenceKey)) });
  };
  const allocate = async (occ, transactionId, amountString) => {
    try {
      const amountCents = api.cents(amountString);
      const tx = data.transactions.find(t => t.id === transactionId);
      if (!tx || amountCents <= 0) throw new Error("Choose a transaction and enter an amount greater than zero.");
      const used = (data.allocations || []).filter(a => a.transactionId === tx.id).reduce((s, a) => s + a.amountCents, 0);
      if (used + amountCents > tx.amountCents) throw new Error("That is more than the transaction’s unallocated amount.");
      if (tx.direction !== occ.direction || tx.accountId !== (occ.accountId || data.assignments?.[ruleKey(occ)] || "legacy-opening")) throw new Error("This transaction doesn’t match the occurrence’s direction and assigned account.");
      const item = { id: crypto.randomUUID(), transactionId: tx.id, occurrenceKey: occ.key, amountCents };
      if (await update("allocations", [...(data.allocations || []), item])) {
        setAllocationForm(previous => { const next = { ...previous }; delete next[occ.key]; return next; });
      }
    } catch (e) { setNotice(e.message || "Unable to match these amounts."); }
  };
  const unmatch = async allocation => {
    const allocations = data.allocations.filter(a => a.id !== allocation.id);
    await save({ ...data, allocations, settlements: data.settlements.filter(s => allocations.some(a => a.occurrenceKey === s.occurrenceKey)) });
  };
  const assign = async (occ, accountId) => {
    const assignments = { ...(data.assignments || {}) };
    if (accountId) assignments[ruleKey(occ)] = accountId;
    else delete assignments[ruleKey(occ)];
    await update("assignments", assignments);
  };
  const settle = async occ => {
    const key = occ.key;
    const settlements = data.settlements || [];
    const exists = settlements.some(s => s.occurrenceKey === key && s.closed);
    const next = exists
      ? settlements.filter(s => s.occurrenceKey !== key)
      : [...settlements.filter(s => s.occurrenceKey !== key), { occurrenceKey: key, closed: true }];
    await update("settlements", next);
  };
  const deleteCheckpoint = async c => {
    if (!window.confirm("Remove this starting-balance checkpoint? Forecasts after it may change.")) return;
    await update("checkpoints", data.checkpoints.filter(x => x.id !== c.id));
  };
  const filteredOccurrences = api.nearToday(yearsOccurrences.filter(o => {
    const text = `${o.name || ""} ${o.origin || ""} ${o.kind || ""}`.toLowerCase();
    return (!search || text.includes(search.toLowerCase())) &&
      (!dateFilter || o.date === dateFilter) &&
      (accountFilter === "all" || (o.accountId || data.assignments?.[ruleKey(o)] || "legacy-opening") === accountFilter);
  }), today);
  const linkedTo = key => (data.allocations || []).filter(a => a.occurrenceKey === key);
  const txAllocated = id => (data.allocations || []).filter(a => a.transactionId === id).reduce((s, a) => s + a.amountCents, 0);
  const transactions = (data.transactions || []).filter(t => accountFilter === "all" || t.accountId === accountFilter).reverse().sort((a, b) => b.date.localeCompare(a.date));
  const overdue = api.nearToday(decorated.filter(o => o.date < today && o.date >= (data.cutoverDate || "0000-01-01") && o.remainingCents > 0 && !o.closed && !o.skipped)
    .filter(o => accountFilter === "all" || (o.accountId || data.assignments?.[ruleKey(o)] || "legacy-opening") === accountFilter), today);
  const unallocated = transactions.filter(t => t.amountCents - txAllocated(t.id) > 0);
  const openPanel = (name) => { setEditing(null); setPanel(name); };

  const input = (label, value, onChange, type = "text", props = {}) => h("label", { className: "lw-field", key: label },
    h("span", null, label), h("input", { type, value, onChange: e => onChange(e.target.value), ...props }));
  const selectField = (label, value, onChange, options, disabled = false) => h("label", { className: "lw-field", key: label },
    h("span", null, label), h("select", { value, onChange: e => onChange(e.target.value), disabled },
      options.map(o => h("option", { value: o.value, key: o.value }, o.label))));
  const action = (label, fn, secondary = false) => h("button", { type: "button", className: secondary ? "lw-button lw-button-quiet" : "lw-button", onClick: fn }, label);
  const panelTitle = { account: editing ? "Edit account" : "Add an account", checkpoint: editing ? "Edit checkpoint" : "Add starting balance", transaction: editing ? "Edit transaction" : "Add actual transaction" }[panel];
  const closePanel = () => setPanel("");
  useEffect(() => {
    setPlanLimit(12); setActualLimit(12); setOverdueLimit(5);
  }, [accountFilter, search, dateFilter, year]);
  const focusForecastToday = () => {
    const container = forecastListRef.current;
    const target = container?.querySelector(`[data-date="${api.dateInYear(year, today)}"]`);
    if (target) container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top;
  };
  useEffect(() => {
    const frame = requestAnimationFrame(focusForecastToday);
    return () => cancelAnimationFrame(frame);
  }, [year, today]);
  useEffect(() => {
    if (!panel) return;
    const previousFocus = document.activeElement;
    const focusable = () => [...document.querySelectorAll('.lw-modal button:not(:disabled), .lw-modal input:not(:disabled), .lw-modal select:not(:disabled)')];
    const frame = requestAnimationFrame(() => { const fields = focusable(); (fields.find(el => el.tagName !== 'BUTTON') || fields[0])?.focus(); });
    const onKey = e => {
      if (e.key === "Escape") closePanel();
      if (e.key === 'Tab') {
        const fields = focusable(), first = fields[0], last = fields[fields.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); cancelAnimationFrame(frame); previousFocus?.focus(); };
  }, [panel]);

  if (calculation.error) return h("section", { className: "ledger-workspace" },
    h("h2", null, "Forecast unavailable"),
    h("p", { role: "alert" }, calculation.error),
    action("Reload latest", refreshLatest));

  return h("section", { className: "ledger-workspace" },
    h("header", { className: "lw-header" },
      h("div", null, h("p", { className: "lw-eyebrow" }, "MERCURY · RECONCILIATION"), h("h1", null, "Plans, meet real life."), h("p", { className: "lw-intro" }, "Add real account balances and transactions. Match them when you’re ready—nothing is matched for you.")),
      h("div", { className: "lw-head-actions" }, action("Reload latest", refreshLatest, true), h("span", { className: "lw-year" }, year))
    ),
    h("p", { className: "lw-notice" }, `Checkpoints mean start of day in ${data.timeZone || "your calendar timezone"}; same-day transactions follow that balance. Your opening account preserves the earlier projected plan, not confirmed bank history. Verify legacy balances with a manual checkpoint. Accounts without a checkpoint start at $0 provisionally.`),
    (error || message) && h("div", { className: `lw-notice ${error ? "is-error" : ""}`, role: error ? "alert" : "status" },
      h("span", null, error || message), error && action("Reload latest", refreshLatest, true)),
    h("div", { className: "lw-filterbar" },
      h("label", { className: "lw-filter" }, h("span", null, "View account"), h("select", { value: accountFilter, onChange: e => setAccountFilter(e.target.value) }, h("option", { value: "all" }, "All accounts · separate balances"), accounts.map(a => h("option", { key: a.id, value: a.id }, `${a.name}${a.archived ? " · archived" : ""}`)))),
      h("p", { className: "lw-filter-note" }, "All accounts are shown as a combined view only; savings aren’t assumed to cover checking.")
    ),
    calculation.accountRisks.map(({ account, shortfall }) => h("div", { className: "lw-notice", key: account.id, role: "status" },
      h("span", null, `${account.name} has a provisional shortfall of ${money(shortfall.endingCents)} on ${dateText(shortfall.date)}, even if other accounts have money.`),
      action("View account", () => setAccountFilter(account.id), true))),
    h("section", { className: "lw-summary-grid", "aria-label": "Forecast at a glance" },
      h("article", { className: "lw-summary lw-summary-accent" }, h("span", null, "Forecast checkpoints"), h("strong", null, `${forecast.filter(x => x.checkpoint).length}`), h("small", null, "Starting balances ground the dates ahead.")),
      h("article", { className: "lw-summary" }, h("span", null, "Needs a look"), h("strong", null, `${overdue.length}`), h("small", null, "Past plan dates with something still unaccounted for.")),
      h("article", { className: "lw-summary" }, h("span", null, "Unallocated actuals"), h("strong", null, `${unallocated.length}`), h("small", null, "Transactions with money left to match."))
    ),
    h("div", { className: "lw-columns" },
      h("section", { className: "lw-card lw-accounts" },
        h("div", { className: "lw-section-head" }, h("div", null, h("p", { className: "lw-eyebrow" }, "YOUR ACCOUNTS"), h("h2", null, "A clear starting point")), action("＋ Account", () => startAccount())),
        !accounts.length && h("div", { className: "lw-empty" }, h("strong", null, "Start with an account"), h("p", null, "A checking or savings account gives your forecast somewhere real to begin."), action("Add your first account", () => startAccount())),
        h("div", { className: "lw-account-list" }, accounts.filter(a => showArchived || !a.archived).map(a => h("div", { className: "lw-account-row", key: a.id },
          h("div", { className: "lw-account-mark" }, a.type === "checking" ? "C" : "S"),
          h("div", { className: "lw-account-name" }, h("strong", null, a.name), h("small", null, `${a.type === "checking" ? "Checking" : "Savings"}${a.archived ? " · archived" : ""}`)),
          h("div", { className: "lw-row-actions" }, action("Edit", () => startAccount(a), true), action(a.archived ? "Restore" : "Archive", () => archiveAccount(a), true))
        ))),
        accounts.some(a => a.archived) && h("button", { className: "lw-text-button", onClick: () => setShowArchived(!showArchived) }, showArchived ? "Hide archived accounts" : "Show archived accounts"),
        h("div", { className: "lw-subsection" }, h("div", { className: "lw-section-head" }, h("div", null, h("p", { className: "lw-eyebrow" }, "START OF DAY"), h("h3", null, "Balance checkpoints")), action("＋ Checkpoint", () => startCheckpoint(), true)),
          h("p", { className: "lw-help" }, "A checkpoint is the actual balance at the start of that local date. Transactions dated the same day come after it."),
          !(data.checkpoints || []).length ? h("p", { className: "lw-muted" }, "No checkpoints yet.") : h("div", { className: "lw-simple-list" }, [...data.checkpoints].sort((a,b) => b.date.localeCompare(a.date)).slice(0, checkpointLimit).map(c => h("div", { className: "lw-simple-row", key: c.id },
            h("span", null, h("strong", null, accountName(c.accountId)), h("small", null, `${dateText(c.date)} · start of day${c.source === "legacy" ? " · imported" : ""}`)),
            h("b", null, money(c.balanceCents)),
            h("span", { className: "lw-row-actions" }, action("Edit", () => startCheckpoint(c), true), action("Remove", () => deleteCheckpoint(c), true))
          ))),
          data.checkpoints.length > checkpointLimit && action(`Show earlier checkpoints (${data.checkpoints.length - checkpointLimit} more)`, () => setCheckpointLimit(checkpointLimit + 10), true)
        )
      ),
      h("section", { className: "lw-card lw-forecast" },
        action("Jump to today", focusForecastToday, true),
        h("div", { className: "lw-section-head" }, h("div", null, h("p", { className: "lw-eyebrow" }, "DATED OUTLOOK"), h("h2", null, "Your forecast"), h("p", { className: "lw-help" }, accountFilter === "all" ? "A combined view only—not a transfer between accounts. Choose one account to inspect its provisional balance." : "A provisional path from this account’s latest checkpoint. Planned amounts remain estimates until matched."))),
        !forecast.length ? h("div", { className: "lw-empty lw-empty-small" }, h("strong", null, "A forecast will take shape here"), h("p", null, "Add a starting balance checkpoint and your dated plan will show up day by day.")) :
        h("div", { className: "lw-forecast-list", ref: forecastListRef }, forecast.map((f, i) => h("div", { className: `lw-forecast-row ${f.checkpoint ? "is-checkpoint" : ""}`, "data-date": f.date, key: `${f.date}-${i}` },
          h("div", { className: "lw-date-marker" }, h("strong", null, new Date(f.date + "T12:00:00").toLocaleDateString(undefined, { day: "2-digit" })), h("small", null, new Date(f.date + "T12:00:00").toLocaleDateString(undefined, { month: "short" }))),
          h("div", { className: "lw-forecast-detail" }, h("strong", null, dateText(f.date)), h("small", null, `${f.checkpoint ? `Start checkpoint ${money(f.startingCents)} · ` : ""}${f.actualCents ? `Actual ${money(f.actualCents)}` : "No actuals"} · planned ${money(f.plannedCents)}`)),
          h("div", { className: "lw-forecast-balance" }, h("small", null, "Projected end"), h("strong", null, money(f.endingCents)))
        )))
      )
    ),
    h("section", { className: "lw-card lw-plan-card" },
      h("div", { className: "lw-section-head lw-plan-header" }, h("div", null, h("p", { className: "lw-eyebrow" }, "PLAN REVIEW"), h("h2", null, "Match only what you recognize"), h("p", { className: "lw-help" }, "Suggestions are for review, never automatic. One plan can include several actuals, and one actual can be split.")),
        h("div", { className: "lw-plan-filters" }, h("label", { className: "lw-field" }, h("span", null, "Search plan"), h("input", { value: search, placeholder: "Name or source", onChange: e => setSearch(e.target.value) })),
          h("label", { className: "lw-field" }, h("span", null, "Exact date"), h("input", { type: "date", value: dateFilter, onChange: e => setDateFilter(e.target.value) }))),
      ),
      h("div", { className: "lw-overdue-callout" }, h("strong", null, `${overdue.length} overdue ${overdue.length === 1 ? "item" : "items"} to review`), h("span", null, nextShortfall ? `This provisional forecast dips below zero around ${dateText(nextShortfall.date)}. It’s a prompt to review—not a safe-to-spend number.` : "Remaining plan amount is not proof that a payment was missed. Review actuals and matches below.")),
      overdue.length > 0 && h("div", { className: "lw-overdue-list" }, overdue.slice(0, overdueLimit).map(o => h("div", { className: "lw-overdue-item", key: o.key },
        h("span", null, h("strong", null, o.name || o.origin || "Planned item"), h("small", null, `${dateText(o.date)} · ${accountName(o.accountId || data.assignments?.[ruleKey(o)] || "legacy-opening")}`)),
        h("b", null, `${money(o.remainingCents)} remaining`)
      ))),
      overdue.length > overdueLimit && action(`Show earlier overdue items (${overdue.length - overdueLimit} more)`, () => setOverdueLimit(overdueLimit + 10), true),
      !filteredOccurrences.length ? h("div", { className: "lw-empty lw-empty-small" }, h("strong", null, "Nothing on these dates"), h("p", null, "Try another search, date, or account.")) :
      h("div", { className: "lw-occurrence-list" }, filteredOccurrences.slice(0, planLimit).map(o => {
        const assigned = o.accountId || data.assignments?.[ruleKey(o)] || "legacy-opening";
        const linked = linkedTo(o.key);
        const candidates = transactions.filter(t => t.accountId === assigned && t.direction === o.direction && t.amountCents - txAllocated(t.id) > 0)
          .sort((a, b) => {
            const score = t => Math.abs(new Date(t.date) - new Date(o.date)) / 86400000 +
              (Math.abs(t.amountCents - o.amountCents) / Math.max(o.amountCents, 1)) * 3 +
              ((t.description || "").toLowerCase().includes((o.name || "").toLowerCase()) && o.name ? -2 : 0);
            return score(a) - score(b);
          });
        const allocState = allocationForm[o.key] || { transactionId: "", amount: "" };
        const status = o.status || "Expected";
        return h("article", { className: "lw-occurrence", key: o.key },
          h("div", { className: "lw-occ-head" },
            h("div", { className: "lw-occ-title" }, h("span", { className: `lw-direction-dot ${o.direction}` }), h("div", null, h("strong", null, o.name || o.origin || "Planned item"), h("small", null, `${dateText(o.date)} · ${o.kind === "recurring" ? "Recurring" : "One-off"}${o.skipped ? " · skipped in plan" : ""}`))),
            h("div", { className: "lw-occ-amount" }, h("small", null, o.direction === "income" ? "Planned in" : "Planned out"), h("strong", null, money(o.amountCents)))
          ),
          h("div", { className: "lw-occ-meta" }, h("span", { className: `lw-status ${status.toLowerCase().replaceAll(" ", "-")}` }, status), h("span", null, `Remaining ${money(o.remainingCents)}`), o.varianceCents ? h("span", null, `Variance ${money(o.varianceCents)}`) : null,
            h("label", { className: "lw-inline-select" }, h("span", null, "Account"), h("select", { value: assigned, onChange: e => assign(o, e.target.value) }, accountChoices(assigned).map(a => h("option", { key: a.value, value: a.value }, a.label)))),
             h("button", { type: "button", className: "lw-text-button", disabled: o.skipped || (!o.closed && !o.allocatedCents), onClick: () => settle(o) }, o.closed ? "Reopen" : "Mark complete")
          ),
          linked.length > 0 && h("div", { className: "lw-match-list" }, linked.map(a => {
            const t = data.transactions.find(tx => tx.id === a.transactionId);
            return h("div", { className: "lw-match-row", key: a.id }, h("span", null, `Matched ${money(a.amountCents)} · ${t?.description || "Transaction"} · ${dateText(t?.date)}`), action("Undo match", () => unmatch(a), true));
          })),
          !o.closed && !o.skipped && h("div", { className: "lw-match-control" },
            h("label", { className: "lw-field" }, h("span", null, "Review an actual"), h("select", { value: allocState.transactionId, onChange: e => { const t = data.transactions.find(x => x.id === e.target.value); setAllocationForm({ ...allocationForm, [o.key]: { transactionId: e.target.value, amount: t ? ((Math.min(t.amountCents - txAllocated(t.id), o.remainingCents) / 100).toFixed(2)) : "" } }); } },
              h("option", { value: "" }, candidates.length ? "Choose a possible match" : "No possible matches yet"),
              candidates.map(t => h("option", { value: t.id, key: t.id }, `${dateText(t.date)} · ${t.description || "Actual"} · ${money(t.amountCents - txAllocated(t.id))} unallocated · ${money(t.amountCents)} total`)))),
            h("label", { className: "lw-field" }, h("span", null, "Amount to match"), h("input", { value: allocState.amount, onChange: e => setAllocationForm({ ...allocationForm, [o.key]: { ...allocState, amount: e.target.value } }), inputMode: "decimal", placeholder: "0.00" })),
            h("button", { type: "button", className: "lw-button lw-match-button", disabled: !allocState.transactionId, onClick: () => allocate(o, allocState.transactionId, allocState.amount) }, "Add match")
          )
        );
      })),
      filteredOccurrences.length > planLimit && action(`Show more plans (${filteredOccurrences.length - planLimit} remaining)`, () => setPlanLimit(planLimit + 12), true)
    ),
    h("section", { className: "lw-card lw-actuals" },
      h("p", { className: "lw-help" }, "Most recent transactions first. Earlier records remain below."),
      h("div", { className: "lw-section-head" }, h("div", null, h("p", { className: "lw-eyebrow" }, "REAL TRANSACTIONS"), h("h2", null, "Your actuals"), h("p", { className: "lw-help" }, "Unallocated amounts stay visible here. Nothing changes your plan.")), action("＋ Add actual", () => startTransaction())),
      !transactions.length ? h("div", { className: "lw-empty lw-empty-small" }, h("strong", null, "Add an actual when you’re ready"), h("p", null, "Transactions can be entered for today or a past date, and matched in part or in full.")) :
        h("div", { className: "lw-transaction-list" }, transactions.slice(0, actualLimit).map(t => {
          const remaining = t.amountCents - txAllocated(t.id);
          const matches = (data.allocations || []).filter(a => a.transactionId === t.id);
          return h("article", { className: "lw-transaction", key: t.id },
            h("div", { className: "lw-tx-main" }, h("span", { className: `lw-direction-dot ${t.direction}` }), h("div", null, h("strong", null, t.description || (t.direction === "income" ? "Income" : "Expense")), h("small", null, `${dateText(t.date)} · ${accountName(t.accountId)} · ${t.direction}`))),
            h("div", { className: "lw-tx-numbers" }, h("strong", null, money(t.amountCents)), h("small", null, `${money(remaining)} unallocated`)),
            h("div", { className: "lw-row-actions" }, action("Edit", () => startTransaction(t), true), action("Delete", () => deleteTransaction(t), true)),
            matches.length > 0 && h("div", { className: "lw-tx-matches" }, matches.map(a => h("div", { key: a.id }, h("span", null, `Matched ${money(a.amountCents)} · ${decorated.find(o => o.key === a.occurrenceKey)?.name || "Plan item"}`), action("Undo", () => unmatch(a), true))))
          );
        })),
      transactions.length > actualLimit && action(`Show earlier actuals (${transactions.length - actualLimit} more)`, () => setActualLimit(actualLimit + 12), true)
    ),
    panel && h("div", { className: "lw-modal-backdrop", onMouseDown: e => { if (e.target === e.currentTarget) closePanel(); } },
      h("section", { className: "lw-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "lw-modal-title" },
        h("div", { className: "lw-modal-head" }, h("div", null, h("p", { className: "lw-eyebrow" }, "MERCURY LEDGER"), h("h2", { id: "lw-modal-title" }, panelTitle)), h("button", { type: "button", className: "lw-close", onClick: closePanel, "aria-label": "Close dialog" }, "×")),
        h("form", { onSubmit: panel === "account" ? submitAccount : panel === "checkpoint" ? submitCheckpoint : submitTransaction },
          h("fieldset", { disabled: !!busy || saving },
            panel === "account" ? h(React.Fragment, null,
              input("Account name", accountForm.name, v => setAccountForm({ ...accountForm, name: v }), "text", { required: true, maxLength: 60, autoFocus: true }),
              selectField("Type", accountForm.type, v => setAccountForm({ ...accountForm, type: v }), [{ value: "checking", label: "Checking" }, { value: "savings", label: "Savings" }]),
              h("p", { className: "lw-form-note" }, "Archiving keeps your history and commitments; archived accounts can’t receive new transactions or assignments.")
            ) : panel === "checkpoint" ? h(React.Fragment, null,
              selectField("Account", checkpointForm.accountId, v => setCheckpointForm({ ...checkpointForm, accountId: v }), accountChoices(checkpointForm.accountId)),
              input("Starting balance date", checkpointForm.date, v => setCheckpointForm({ ...checkpointForm, date: v }), "date", { max: today, required: true }),
              input("Balance at start of day", checkpointForm.balance, v => setCheckpointForm({ ...checkpointForm, balance: v }), "number", { min: "-999999999", step: "0.01", inputMode: "decimal", required: true }),
              h("p", { className: "lw-form-note" }, "Transactions dated on this day are counted after this balance.")
            ) : h(React.Fragment, null,
              selectField("Account", transactionForm.accountId, v => setTransactionForm({ ...transactionForm, accountId: v }), accountChoices(transactionForm.accountId)),
              input("Date", transactionForm.date, v => setTransactionForm({ ...transactionForm, date: v }), "date", { max: today, required: true }),
              selectField("Direction", transactionForm.direction, v => setTransactionForm({ ...transactionForm, direction: v }), [{ value: "expense", label: "Money out" }, { value: "income", label: "Money in" }]),
              input("Amount", transactionForm.amount, v => setTransactionForm({ ...transactionForm, amount: v }), "number", { min: "0.01", step: "0.01", inputMode: "decimal", required: true }),
              input("Description", transactionForm.description, v => setTransactionForm({ ...transactionForm, description: v }), "text", { maxLength: 100, required: true })
            ),
            h("div", { className: "lw-modal-actions" }, h("button", { type: "button", className: "lw-button lw-button-quiet", onClick: closePanel }, "Cancel"), h("button", { type: "submit", className: "lw-button" }, saving ? "Saving…" : "Save"))
          )
        )
      )
    ),
    (busy || saving) && h("div", { className: "lw-saving", role: "status" }, h("span", null), saving ? "Saving your ledger…" : "Updating your ledger…")
  );
};
