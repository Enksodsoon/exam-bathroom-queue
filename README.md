# Exam Bathroom Queue

A lightweight, cross-device web platform for live exam administration (~10 concurrent staff users: one main queue controller and roaming staff) built with Next.js (App Router, TypeScript) and Tailwind CSS.

## Features

- **Per-Sex FIFO Bathroom Queues**: Separate first-come-first-served queues for Male (`M`) and Female (`F`) students. Up to one Male and one Female student can be in the bathroom simultaneously; marking a second student of an already-occupied sex is rejected (`409 BATHROOM_OCCUPIED`).
- **QR Code & Link Staff Joining (No Accounts)**: Creating a session issues a private controller link (`/s/<sessionId>?key=<controllerKey>`) and a shareable staff join link + scannable QR code (`/s/<sessionId>`). Roaming staff join simply by entering a display name/label.
- **Real-Time Multi-Client Sync**: Versioned polling (`GET /api/sessions/[id]?sinceVersion=N`, `1.2s` active / `5s` background) combined with immediate mutation snapshots and same-browser `BroadcastChannel` updates keep controller and roaming staff views synchronized.
- **Exam Time-Window Enforcement & Override**: The controller configures start time, duration, and the blocked minutes at the start and end of each exam (defaults: first 30, last 20; use 0 to turn off either block). Normal submissions and admissions follow the server clock: opening boundary inclusive, closing boundary exclusive. If the blocks cover the entire exam, no normal request window opens. The timer UI asks for confirmation before saving that setting. The existing controller emergency override is unchanged. Legacy exam records retain 30/20 defaults.
- **Next-Student Alerts**: When the next-in-line student changes for either sex, connected clients display an in-browser visual alert banner (`role="alert"`) and trigger Web Audio chime and `navigator.vibrate` hooks when enabled/supported.
- **Controller Management & Clear Session**: Reorder queued entries, mark students as entered or returned, remove entries, and clear all queued/active/completed records for a session with a single Clear Session action.
- **Responsive Design**: Designed for desktop (`1280x800`), tablet (`768x1024`), and mobile (`375x667`) viewports.

## Local Development

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

By default, local development uses `FileSessionStore` (atomic JSON persistence with per-session async mutexes) stored under `./.data`. You can override the storage directory with:

```bash
EXAMQ_DATA_DIR=/path/to/data
```

See [`.env.example`](./.env.example) for available environment variables.

## Environment Variables (Production / Vercel)

In local development and automated tests, `FileSessionStore` is selected automatically when Redis environment variables are unset.

In production on Vercel (`VERCEL=1`), serverless functions do not share local filesystem state across invocations, so Redis is **required** (otherwise `/api/health` returns HTTP `500` and mutations fail with `STORAGE_MISCONFIGURED`). Configure **either** pair:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (checked first)
- `KV_REST_API_URL` and `KV_REST_API_TOKEN`

## Verification & Testing

Run static checks, unit/integration tests, and production build:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Run the Playwright smoke & adversarial UI specs:

```bash
npx playwright test tests/e2e/m3-smoke.spec.ts tests/e2e/tier5-adversarial-ui.spec.ts --reporter=list
```

Run the full opaque-box Playwright E2E suite (241 tests across 14 spec files; builds/starts an isolated server on `127.0.0.1:3199` with `EXAMQ_DATA_DIR`):

```bash
npx playwright test -c playwright.e2e-suite.config.ts
```

Run the E2E suite against an external/live deployment (skips local `webServer`):

```powershell
$env:PLAYWRIGHT_BASE_URL = "https://<your-app>.vercel.app"
npx playwright test -c playwright.e2e-suite.config.ts
```

```bash
PLAYWRIGHT_BASE_URL="https://<your-app>.vercel.app" npx playwright test -c playwright.e2e-suite.config.ts
```

## Deploying to Vercel

1. Authenticate and link your Vercel project:
   ```bash
   npx vercel login
   npx vercel link --yes --project exam-bathroom-queue
   ```
2. Provision Upstash Redis (via Vercel Marketplace/Integration or Upstash console) and configure Production environment variables:
   ```bash
   npx vercel env add UPSTASH_REDIS_REST_URL --environment production
   npx vercel env add UPSTASH_REDIS_REST_TOKEN --environment production
   ```
3. Deploy to production:
   ```bash
   npx vercel deploy --prod --yes
   ```
4. Verify storage health:
   ```bash
   curl https://<your-app>.vercel.app/api/health
   # Expected: {"ok":true,"storage":"upstash-redis"}
   ```
