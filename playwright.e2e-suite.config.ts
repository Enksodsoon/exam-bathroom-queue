import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = (
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.EXAMQ_BASE_URL ||
  ''
)
  .trim()
  .replace(/\/+$/, '');

const port = Number(process.env.E2E_PORT || 3199);
const baseURL = externalBaseUrl || `http://127.0.0.1:${port}`;
const useDevServer = process.env.E2E_USE_DEV === '1';

const dataDir =
  process.env.EXAMQ_DATA_DIR || path.join(os.tmpdir(), 'examq-e2e-suite-data');

if (!externalBaseUrl && !process.env.TEST_WORKER_INDEX) {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
}

const hasProdBuild = fs.existsSync(path.join(__dirname, '.next', 'BUILD_ID'));
const startCmd = useDevServer
  ? `npm run dev -- -H 127.0.0.1 -p ${port}`
  : hasProdBuild
    ? `npm run start -- -H 127.0.0.1 -p ${port}`
    : `npm run build && npm run start -- -H 127.0.0.1 -p ${port}`;

export default defineConfig({
  testDir: './tests/e2e_suite',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI || externalBaseUrl ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  outputDir: 'test-results-e2e-suite',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-e2e-suite', open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: startCmd,
          url: `${baseURL}/api/health`,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            ...process.env,
            EXAMQ_DATA_DIR: dataDir,
            PORT: String(port),
            HOSTNAME: '127.0.0.1',
          },
        },
      }),
});
