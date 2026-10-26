# Finance browser regressions

From the repository root:

```sh
npm ci
npm --prefix Mercury ci
npm run test:browser:install
npm test
```

`npm test` runs the existing logout unit tests and then the browser suite.
Use `npm run test:browser` to run just the browser checks, or
`npm run test:browser -- --grep "One-Off Income"` for one workflow.
On Linux outside Replit, install Chromium's operating-system prerequisites
with `npx playwright install --with-deps chromium` if needed.

No running Mercury server, database, secrets, account, or network access is
needed after dependency/browser installation. Tests navigate to the synthetic
`http://mercury.test` origin, serve the actual `Mercury/index.html` through
Playwright interception, and fulfill its pinned CDN scripts from npm packages.
Integrity checks remain enabled. Only Chart.js's integrity value is adapted in
the served test response: jsDelivr re-minifies its bundle, so npm's equivalent
upstream UMD has different bytes. Production HTML is never changed.
Fonts are replaced by empty CSS.
All other network requests are blocked **and fail the test**, including unknown
API routes. There is deliberately no configurable real API/base URL.

Each test gets a new browser context, a fixed June 15, 2026 clock, a synthetic
user, and fresh in-memory finance data. Intercepted saves update only that
test's memory, allowing reload assertions and checks of submitted values.
Sign-in redirects end at an intercepted placeholder, never the auth provider.
Production authentication is untouched and never bypassed on a real server.

Coverage: four-view navigation/deep links; recurring and one-off income/expense
create/edit/delete with save payloads and reloads; calendar balance check-in
save/cancel/remove; light/dark persistence; signed-out deep links and expired
sessions. Uncaught page errors also fail tests.

Failure screenshots, traces, and the HTML report are written under ignored
`generated-artifacts/playwright/`. Open the report with:

```sh
npx playwright show-report generated-artifacts/playwright/report
```

This suite tests the browser contract, not the real API, database persistence,
or identity provider. Keep the local library versions aligned with the CDN
versions and integrity hashes in `Mercury/index.html`.

On Replit/Nix the configuration automatically uses the environment's wrapped
Chromium (downloaded Linux browsers lack Nix library paths). Elsewhere it uses
the browser installed by Playwright.
