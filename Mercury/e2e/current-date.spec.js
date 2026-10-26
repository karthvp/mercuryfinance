const { test, expect } = require('./fixtures');
const m = require('../ledger-model');

test('calendar opens at today on entry and reload, respects month choices, and has a Today shortcut', async ({ page, finance }) => {
  await finance.open('calendar');
  const body = page.getByTestId('calendar-scroll');
  const row = body.locator('[data-date="2026-06-15"]');
  const nearTop = async () => expect.poll(() => row.evaluate(el => Math.abs(el.getBoundingClientRect().top - el.parentElement.getBoundingClientRect().top))).toBeLessThan(3);
  await nearTop();
  await page.getByRole('button', { name: 'Jan', exact: true }).click();
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeLessThan(3);
  // An unrelated data/render update must not override the user's selected month.
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeLessThan(3);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await nearTop();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await nearTop();
  await page.reload();
  await nearTop();
});

test('Actuals forecast begins at today and plans and transactions prioritize relevant dates without hiding history', async ({ page, finance }) => {
  finance.data.oneOffExpenses = [
    { id: 'old', name: 'January history', date: '2026-01-02', amount: 10 },
    { id: 'now', name: 'Today bill', date: '2026-06-15', amount: 20 },
    { id: 'next', name: 'Next bill', date: '2026-06-16', amount: 30 },
  ];
  const ledger = m.initialLedger(finance.data, '2026-06-15');
  ledger.transactions = [
    { id: 'old-tx', accountId: m.OPENING, direction: 'expense', amountCents: 1000, date: '2026-01-02', description: 'Old actual' },
    { id: 'now-tx', accountId: m.OPENING, direction: 'expense', amountCents: 2000, date: '2026-06-15', description: 'Latest actual' },
  ];
  finance.enableLedger(ledger);
  await finance.open('accounts');
  const current = page.locator('.lw-forecast-list [data-date="2026-06-15"]');
  await expect.poll(() => current.evaluate(el => Math.abs(el.getBoundingClientRect().top - el.parentElement.getBoundingClientRect().top))).toBeLessThan(3);
  await expect(page.locator('.lw-transaction').first()).toContainText('Latest actual');
  await expect(page.locator('.lw-occurrence').first()).toContainText('Today bill');
  await expect(page.locator('.lw-occurrence')).toHaveCount(12);
  await page.getByRole('button', { name: /Show more plans/ }).click();
  await expect(page.locator('.lw-occurrence')).toHaveCount(24);
  await page.getByRole('textbox', { name: 'Search plan' }).fill('January history');
  await expect(page.locator('.lw-occurrence').filter({ hasText: 'January history' })).toHaveCount(1);
  await page.locator('.lw-forecast-list').evaluate(el => { el.scrollTop = 0; });
  await page.getByRole('combobox', { name: 'View account', exact: true }).selectOption(m.OPENING);
  await expect.poll(() => page.locator('.lw-forecast-list').evaluate(el => el.scrollTop)).toBeLessThan(3);
  await page.getByRole('button', { name: 'Jump to today', exact: true }).click();
  await expect.poll(() => current.evaluate(el => Math.abs(el.getBoundingClientRect().top - el.parentElement.getBoundingClientRect().top))).toBeLessThan(3);
});

test('multi-year Dashboard and Actuals use the same complete forecast history', async ({ page, finance }) => {
  finance.data.initialBalances[2028] = 0;
  const ledger = m.initialLedger(finance.data, '2026-06-15');
  ledger.accounts.push({ id: 'no-checkpoint', name: 'No checkpoint checking', type: 'checking', archived: false });
  ledger.assignments['income:recurring:1'] = 'no-checkpoint';
  finance.enableLedger(ledger);
  await finance.open();
  await page.getByLabel('Forecast account', { exact: true }).selectOption('no-checkpoint');
  await page.locator('.app-year-selector select').first().selectOption('2028');
  const expected = m.forecast(ledger, m.occurrences(finance.data, 2026, 2029, '2026-06-15'), 2028, '2026-06-15', 'no-checkpoint');
  await expect(page.locator('.app-hero-balance')).toHaveText(m.money(expected[0].startingCents));
  await page.getByRole('button', { name: 'Actuals', exact: true }).click();
  await page.getByRole('combobox', { name: 'View account', exact: true }).selectOption('no-checkpoint');
  await expect(page.locator('.lw-forecast-row').first()).toContainText(m.money(expected[0].endingCents));
});

test('phone calendar and Actuals also begin at the current date', async ({ page, finance }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  finance.enableLedger(m.initialLedger(finance.data, '2026-06-15'));
  await finance.open('calendar');
  const row = page.getByTestId('calendar-scroll').locator('[data-date="2026-06-15"]');
  await expect.poll(() => row.evaluate(el => Math.abs(el.getBoundingClientRect().top - el.parentElement.getBoundingClientRect().top))).toBeLessThan(3);
  await finance.open('accounts');
  const current = page.locator('.lw-forecast-list [data-date="2026-06-15"]');
  await expect.poll(() => current.evaluate(el => Math.abs(el.getBoundingClientRect().top - el.parentElement.getBoundingClientRect().top))).toBeLessThan(3);
});
