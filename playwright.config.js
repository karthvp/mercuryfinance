const { defineConfig } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Replit/Nix supplies a wrapped Chromium with its native libraries. Standard
// Linux/macOS/Windows use Playwright's installed Chromium instead.
const nixBrowser = fs.existsSync('/nix/store')
  ? fs.readdirSync('/nix/store')
    .filter(name => name.includes('-playwright-chromium-'))
    .map(name => path.join('/nix/store', name, 'chrome-linux/chrome'))
    .find(file => fs.existsSync(file))
  : undefined;

module.exports = defineConfig({
  testDir: './Mercury/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  timeout: 30000,
  expect: { timeout: 10000 },
  outputDir: 'generated-artifacts/playwright/results',
  reporter: [['list'], ['html', {
    outputFolder: 'generated-artifacts/playwright/report', open: 'never',
  }]],
  use: {
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    launchOptions: nixBrowser ? { executablePath: nixBrowser } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
