import { expect, test } from '@playwright/test';
import {
  ExamQApiClient,
  createConfiguredSession,
} from './helpers/apiClient';
import { VIEWPORTS } from './helpers/contracts';
import {
  assertResponsiveUsability,
  attachErrorGuards,
} from './helpers/layoutAudit';
import { verifyAndDecodeSessionQr } from './helpers/qrHelper';
import { Selectors } from './helpers/selectors';
import { ControllerPage, HomePage, StaffPage } from './helpers/sessionPages';

test.describe('Tier 1 — Cross-Device UI, Multi-Client & Deployment Health (F-D1..F-D3)', () => {
  // F-D1: Cross-Device Responsive UI (5 tests)
  test('T1-FD1-01: Home and Controller Dashboard render cleanly on Desktop (1280x800)', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const ctx = await browser.newContext({ viewport: VIEWPORTS.desktop });
    try {
      const page = await ctx.newPage();
      const errors = attachErrorGuards(page);

      await new HomePage(page).goto();
      await assertResponsiveUsability(page, 'desktop', errors);

      await new ControllerPage(page).goto(s.sessionId, s.controllerKey);
      await assertResponsiveUsability(page, 'desktop', errors);
    } finally {
      await ctx.close();
    }
  });

  test('T1-FD1-02: Controller Dashboard and Staff View render cleanly on Tablet (768x1024)', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const ctx = await browser.newContext({ viewport: VIEWPORTS.tablet });
    try {
      const page = await ctx.newPage();
      const errors = attachErrorGuards(page);

      await new ControllerPage(page).goto(s.sessionId, s.controllerKey);
      await assertResponsiveUsability(page, 'tablet', errors);

      const staffPage = await ctx.newPage();
      const staffErrors = attachErrorGuards(staffPage);
      const staff = new StaffPage(staffPage);
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('Tablet Proctor');
      await assertResponsiveUsability(staffPage, 'tablet', staffErrors);
    } finally {
      await ctx.close();
    }
  });

  test('T1-FD1-03: Staff Join and Staff View render cleanly on Mobile (375x667)', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const ctx = await browser.newContext({ viewport: VIEWPORTS.mobile });
    try {
      const page = await ctx.newPage();
      const errors = attachErrorGuards(page);
      const staff = new StaffPage(page);
      await staff.goto(`/s/${s.sessionId}`);
      await assertResponsiveUsability(page, 'mobile', errors);

      await staff.join('Mobile Proctor');
      await assertResponsiveUsability(page, 'mobile', errors);
    } finally {
      await ctx.close();
    }
  });

  test('T1-FD1-04: Controller Dashboard renders cleanly on Mobile (375x667)', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const ctx = await browser.newContext({ viewport: VIEWPORTS.mobile });
    try {
      const page = await ctx.newPage();
      const errors = attachErrorGuards(page);
      await new ControllerPage(page).goto(s.sessionId, s.controllerKey);
      await assertResponsiveUsability(page, 'mobile', errors);
    } finally {
      await ctx.close();
    }
  });

  test('T1-FD1-05: Populated queues (3M + 3F + active + alert banner) maintain zero overflow across all 3 viewports', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '101' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '102' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '103' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: '201' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: '202' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: '203' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });

    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      const ctx = await browser.newContext({ viewport: vp });
      try {
        const page = await ctx.newPage();
        const errors = attachErrorGuards(page);
        await new ControllerPage(page).goto(s.sessionId, s.controllerKey);
        await assertResponsiveUsability(page, name, errors);
      } finally {
        await ctx.close();
      }
    }
  });

  // F-D2: Multi-Client E2E & Hardening (5 tests)
  test('T1-FD2-01: Two independent sessions created concurrently remain strictly isolated', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const [s1, s2] = await Promise.all([
      createConfiguredSession(api),
      createConfiguredSession(api),
    ]);

    await api.submitEntry(s1.sessionId, { sex: 'M', studentNumber: 'ISO-A' });
    await api.submitEntry(s2.sessionId, { sex: 'F', studentNumber: 'ISO-B' });

    const g1 = await api.getSnapshot(s1.sessionId);
    const g2 = await api.getSnapshot(s2.sessionId);
    if (g1.body.unchanged || g2.body.unchanged) throw new Error('Expected snapshots');

    expect(g1.body.snapshot.entries.map((e) => e.studentNumber)).toEqual(['ISO-A']);
    expect(g2.body.snapshot.entries.map((e) => e.studentNumber)).toEqual(['ISO-B']);
  });

  test('T1-FD2-02: Concurrent GET ?sinceVersion=N polling from 10 parallel requests returns consistent responses', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'POLL-10' });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => api.getSnapshot(s.sessionId, 0)),
    );
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.body.unchanged).toBe(false);
      if (!r.body.unchanged) {
        expect(r.body.snapshot.entries).toHaveLength(1);
      }
    }
  });

  test('T1-FD2-03: 3-client browser flow (1 Controller + 2 Staff) completes submit -> enter -> return cycle with zero errors', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const ctrlCtx = await browser.newContext();
    const st1Ctx = await browser.newContext();
    const st2Ctx = await browser.newContext();
    try {
      const ctrlPage = await ctrlCtx.newPage();
      const st1Page = await st1Ctx.newPage();
      const st2Page = await st2Ctx.newPage();
      const gCtrl = attachErrorGuards(ctrlPage);
      const gSt1 = attachErrorGuards(st1Page);
      const gSt2 = attachErrorGuards(st2Page);

      const ctrl = new ControllerPage(ctrlPage);
      const st1 = new StaffPage(st1Page);
      const st2 = new StaffPage(st2Page);

      await ctrl.goto(s.sessionId, s.controllerKey);
      await st1.goto(`/s/${s.sessionId}`);
      await st1.join('Proctor 1');
      await st2.goto(`/s/${s.sessionId}`);
      await st2.join('Proctor 2');

      await st1.submitStudent('M', 'CYCLE-1');
      await ctrl.expectQueuedVisible('M', 'CYCLE-1');
      await ctrl.enterStudent('M', 'CYCLE-1');
      await st2.expectInBathroom('M', 'CYCLE-1');
      await ctrl.returnStudent('M', 'CYCLE-1');
      await st1.expectVacant('M');
      await st2.expectVacant('M');

      gCtrl.assertZeroErrors();
      gSt1.assertZeroErrors();
      gSt2.assertZeroErrors();
    } finally {
      await ctrlCtx.close();
      await st1Ctx.close();
      await st2Ctx.close();
    }
  });

  test('T1-FD2-04: Fresh API client reads persisted session state after mutations', async ({
    playwright,
    request,
    baseURL,
  }) => {
    const api1 = new ExamQApiClient(request);
    const s = await createConfiguredSession(api1);
    await api1.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'PERSIST-1' });

    const req2 = await playwright.request.newContext({ baseURL });
    try {
      const api2 = new ExamQApiClient(req2);
      const snap = await api2.getSnapshot(s.sessionId);
      expect(snap.status).toBe(200);
      if (snap.body.unchanged) throw new Error('Expected full snapshot');
      expect(snap.body.snapshot.entries.map((e) => e.studentNumber)).toEqual([
        'PERSIST-1',
      ]);
    } finally {
      await req2.dispose();
    }
  });

  test('T1-FD2-05: Browser reload on /s/[id] recovers cleanly and resumes live sync', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const staff = new StaffPage(page);
    await staff.goto(`/s/${s.sessionId}`);
    await staff.join('Reload Tester');
    await staff.submitStudent('M', 'REL-1');
    await staff.expectQueuedVisible('M', 'REL-1');

    await page.reload();
    await staff.expectQueuedVisible('M', 'REL-1');

    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'REL-2' });
    await staff.expectQueuedVisible('F', 'REL-2');
  });

  // F-D3: Clean Build, GitHub & Live Vercel Readiness (5 tests)
  test('T1-FD3-01: GET /api/health returns 200 with ok=true and valid storage adapter', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const h = await api.health();
    expect(h.status).toBe(200);
    expect(h.body.ok).toBe(true);
    expect(['file', 'upstash-redis']).toContain(h.body.storage);
  });

  test('T1-FD3-02: joinUrl and controllerUrl paths are well-formed and portable across active host', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    expect(created.status).toBe(201);
    expect(created.body.joinUrl).toMatch(
      new RegExp(`/s/${created.body.sessionId}/?$`),
    );
    expect(created.body.controllerUrl).toContain(
      `/s/${created.body.sessionId}`,
    );
    expect(created.body.controllerUrl).toContain(created.body.controllerKey);
  });

  test('T1-FD3-03: Primary routes and static assets load with HTTP < 400 and zero failed requests', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const failedResponses: Array<{ url: string; status: number }> = [];
    page.on('response', (res) => {
      if (res.status() >= 400) {
        failedResponses.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto('/');
    await page.goto(`/s/${s.sessionId}?key=${s.controllerKey}`);
    await expect(Selectors.clearSessionButton(page)).toBeVisible();
    expect(failedResponses).toEqual([]);
  });

  test('T1-FD3-04: QR decoded URL resolves cleanly against active baseURL without hardcoded localhost:3000', async ({
    page,
    request,
    baseURL,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const ctrl = new ControllerPage(page);
    await ctrl.goto(s.sessionId, s.controllerKey);
    const qrUrl = await verifyAndDecodeSessionQr(
      page,
      Selectors.qrElement(page),
      s.sessionId,
      s.controllerKey,
    );

    const activeOrigin = new URL(baseURL!).origin;
    const qrOrigin = new URL(qrUrl).origin;
    expect(qrOrigin).toBe(activeOrigin);
  });

  test('T1-FD3-05: Unknown API route returns clean JSON 404 (never 500 or HTML stack trace)', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const res = await api.rawGet('/api/sessions/does-not-exist-99999');
    expect(res.status).toBe(404);
    expect(typeof res.body).toBe('object');
  });
});
