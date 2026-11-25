import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = process.env.EXAMQ_PORT ?? "3000";
const baseURL = process.env.EXAMQ_BASE_URL ?? `http://127.0.0.1:${port}`;
const dataDir =
  process.env.EXAMQ_DATA_DIR ??
  path.join(process.cwd(), ".data", "playwright-e2e");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: process.env.EXAMQ_BASE_URL
    ? undefined
    : {
        command: `npm run start -- -H 127.0.0.1 -p ${port}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: {
          ...process.env,
          EXAMQ_DATA_DIR: dataDir,
        },
      },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "tablet",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 667 },
      },
    },
  ],
});
