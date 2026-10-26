const { test, expect, ORIGIN } = require('./fixtures');

const panel = (page, title) => page.locator('.app-panel')
  .filter({ has: page.locator('.app-panel-header').filter({ hasText: title }) });

test('navigation renders each view and preserves deep links on reload', async ({ page, finance }) => {
  await finance.open();
  for (const [label, view, content] of [
    ['Cash Flow', 'cashflow', 'Cash Flow'],
    ['Debt', 'debt', 'Debt Payoff Planner'],
    ['Calendar', 'calendar', 'Date'],
    ['Dashboard', 'dashboard', 'Income & Expenses'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page).toHaveURL(`${ORIGIN}/#app/${view}`);
    await expect(page.locator('main').getByText(content, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('main').getByText(content, { exact: true })).toBeVisible();
  }
  await expect(page.locator('main canvas').first()).toBeVisible();
});

for (const entry of [
  { title: 'Income Sources', field: 'payrolls', kind: 'income source', submit: 'Add Income', frequency: 'monthly' },
  { title: 'One-Off Income', field: 'oneOffIncomes', kind: 'one-off income', submit: 'Add Income', date: '2026-06-16' },
  { title: 'Recurring Expenses', field: 'recurringExpenses', kind: 'recurring expense', submit: 'Add Expense', frequency: 'monthly' },
  { title: 'One-Off Expenses', field: 'oneOffExpenses', kind: 'one-off expense', submit: 'Add Expense', date: '2026-06-16' },
]) {
  test(`${entry.title}: create, edit, persist, and delete`, async ({ page, finance }) => {
    await finance.open();
    const name = `Regression ${entry.kind}`;
    const edited = `${name} edited`;
    const original = structuredClone(finance.data[entry.field]);
    await panel(page, entry.title).getByRole('button', { name: 'Add', exact: true }).click();
    const form = page.locator('.app-form-card');
    await form.locator('input[type=text]').fill(name);
    await form.getByPlaceholder('0.00').fill('123.45');
    if (entry.date) await form.locator('input[type=date]').fill(entry.date);
    if (entry.frequency) await form.locator('select').first().selectOption(entry.frequency);
    await form.getByRole('button', { name: entry.submit, exact: true }).click();
    await expect(form).toHaveCount(0);
    const row = panel(page, entry.title).locator('.app-item-row').filter({ hasText: name });
    await expect(row).toContainText('$123.45');
    await expect.poll(() => finance.data[entry.field].find(item => item.name === name))
      .toMatchObject({ name, amount: 123.45, ...(entry.date ? { date: entry.date } : { frequency: entry.frequency }) });
    const id = finance.data[entry.field].find(item => item.name === name).id;
    await page.reload();
    await page.getByRole('button', { name: `Edit ${entry.kind} ${name}`, exact: true }).click();
    await expect(form.locator('input[type=text]')).toHaveValue(name);
    await expect(form.getByPlaceholder('0.00')).toHaveValue('123.45');
    await form.locator('input[type=text]').fill(edited);
    await form.getByPlaceholder('0.00').fill('234.56');
    await form.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(panel(page, entry.title).locator('.app-item-row').filter({ hasText: edited })).toContainText('$234.56');
    await expect.poll(() => finance.data[entry.field].find(item => item.id === id))
      .toMatchObject({ name: edited, amount: 234.56 });
    await expect.poll(() => finance.data[entry.field].length).toBe(original.length + 1);
    await page.reload();
    await page.getByRole('button', { name: `Delete ${entry.kind} ${edited}`, exact: true }).click();
    await expect(page.getByRole('button', { name: `Edit ${entry.kind} ${edited}`, exact: true })).toHaveCount(0);
    await expect.poll(() => finance.data[entry.field]).toEqual(original);
    await page.reload();
    await expect(panel(page, entry.title)).not.toContainText(edited);
    expect(finance.writes.length).toBeGreaterThanOrEqual(3);
    // Saving one collection must not overwrite the other financial collections.
    for (const field of ['payrolls', 'recurringExpenses', 'oneOffIncomes', 'oneOffExpenses']) {
      if (field !== entry.field) {
        const before = finance.writes[0][field];
        for (const write of finance.writes) expect(write[field]).toEqual(before);
      }
    }
  });
}

test('calendar check-ins save, survive reload, cancel, and can be removed', async ({ page, finance }) => {
  await finance.open('calendar');
  const row = page.locator('.app-table-row').filter({ has: page.getByText('Jun 15', { exact: true }) });
  const record = () => row.getByRole('button', { name: 'Record actual balance (check-in)', exact: true });
  await record().click();
  await row.getByRole('spinbutton').fill('4321.09');
  await row.getByRole('button', { name: 'Save balance check-in' }).click();
  await expect(row.getByText('Check-in', { exact: true })).toBeVisible();
  await expect(row).toContainText('$4,321.09');
  await expect.poll(() => finance.data.balanceOverrides).toEqual({ '2026-06-15': 4321.09 });
  await page.reload();
  await expect(row.getByText('Check-in', { exact: true })).toBeVisible();
  await record().click();
  await row.getByRole('spinbutton').fill('9999');
  // Escape is the supported keyboard cancellation path. At this viewport the
  // adjacent expense cell overlaps the Cancel button (tracked separately).
  await row.getByRole('spinbutton').press('Escape');
  await expect(row).toContainText('$4,321.09');
  await expect(row.getByRole('spinbutton')).toHaveCount(0);
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove legacy check-in on 2026-06-15' })).toBeVisible();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await row.getByTitle('Remove this legacy check-in', { exact: true }).click();
  await expect(row.getByText('Check-in', { exact: true })).toHaveCount(0);
  await expect.poll(() => finance.data.balanceOverrides).toEqual({});
  await page.reload();
  await expect(row.getByText('Check-in', { exact: true })).toHaveCount(0);
});

test('theme preference persists through navigation and reload in both directions', async ({ page, finance }) => {
  await finance.open();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Debt', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('mercury-theme'))).toBe('dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('mercury-theme'))).toBe('light');
});

for (const view of ['dashboard', 'cashflow', 'debt', 'calendar']) {
  test(`signed-out ${view} deep link redirects before requesting finance data`, async ({ page, finance }) => {
    finance.auth.user = null;
    await page.goto(`${ORIGIN}/#app/${view}`);
    await expect(page).toHaveURL(`${ORIGIN}/api/login`);
    await expect(page.getByRole('heading', { name: 'Intercepted sign-in' })).toBeVisible();
    expect(finance.apiRequests).toEqual(['GET /api/auth/user', 'GET /api/login']);
    expect(finance.writes).toEqual([]);
  });
}

test('expired session while loading finance data redirects to sign-in without saving', async ({ page, finance }) => {
  finance.auth.dataStatus = 401;
  await page.goto(`${ORIGIN}/#app/dashboard`);
  await expect(page).toHaveURL(`${ORIGIN}/api/login`);
  expect(finance.apiRequests).toEqual(['GET /api/auth/user', 'GET /api/ledger', 'GET /api/data', 'GET /api/login']);
  expect(finance.writes).toEqual([]);
});
