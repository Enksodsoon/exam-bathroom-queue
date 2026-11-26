import { expect, test } from '@playwright/test';
import {
  ExamQApiClient,
  allowedWindowConfig,
  createConfiguredSession,
} from './helpers/apiClient';
import { attachErrorGuards } from './helpers/layoutAudit';
import { verifyAndDecodeSessionQr } from './helpers/qrHelper';
import { Selectors } from './helpers/selectors';
import { ControllerPage } from './helpers/sessionPages';

test.describe('Tier 2 — Access, Join & Role Boundaries (F-S1..F-S4)', () => {
  // F-S1 (5 tests)
  test('T2-FS1-01: Burst-creating 5 sessions in parallel produces 5 unique sessionIds and controllerKeys', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api.createSession()),
    );
    for (const r of results) {
      expect(r.status).toBe(201);
    }
    const ids = new Set(results.map((r) => r.body.sessionId));
    const keys = new Set(results.map((r) => r.body.controllerKey));
    expect(ids.size).toBe(5);
    expect(keys.size).toBe(5);
  });

  test('T2-FS1-02: POST /api/sessions with empty {} body succeeds cleanly with 201', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const res = await api.createSession({});
    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBeTruthy();
  });

  test('T2-FS1-03: POST /api/sessions with malformed JSON does not 500 (returns 201 or 400)', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const res = await api.createSession('{broken-json');
    expect([201, 400]).toContain(res.status);
    expect(res.status).toBeLessThan(500);
  });

  test('T2-FS1-04: GET /api/sessions/nonexistent-id returns 404 JSON', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const res = await api.getSnapshot('nonexistent-session-xyz');
    expect(res.status).toBe(404);
    expect(typeof res.body).toBe('object');
  });

  test('T2-FS1-05: Created session ID is URL-safe without spaces or query-breaking characters', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const res = await api.createSession();
    expect(res.body.sessionId).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  // F-S2 (5 tests)
  test('T2-FS2-01: QR decoded URL and share link never leak controllerKey', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const ctrl = new ControllerPage(page);
    await ctrl.goto(s.sessionId, s.controllerKey);
    const shareUrl = await ctrl.getShareUrl();
    expect(shareUrl).not.toContain(s.controllerKey);

    const qrUrl = await verifyAndDecodeSessionQr(
      page,
      Selectors.qrElement(page),
      s.sessionId,
      s.controllerKey,
    );
    expect(qrUrl).not.toContain(s.controllerKey);
  });

  test('T2-FS2-02: Navigating to /s/nonexistent-id renders clean not-found UI with zero pageerror', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/s/nonexistent-session-404');
    await expect(page.locator('body')).toContainText(/not found|unavailable|expired|create/i);
    expect(pageErrors).toEqual([]);
  });

  test('T2-FS2-03: Visiting controllerUrl in fresh context stores key without leaking into rendered share link', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      const ctrl = new ControllerPage(page);
      await ctrl.goto(s.sessionId, s.controllerKey);
      const share = await ctrl.getShareUrl();
      expect(share).toMatch(new RegExp(`/s/${s.sessionId}(?:\\?invite=[^&]+)?/?$`));
      expect(share).not.toContain('key=');
      expect(share).not.toContain(s.controllerKey);
    } finally {
      await ctx.close();
    }
  });

  test('T2-FS2-04: GET ?sinceVersion=0 returns full snapshot (unchanged: false)', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const res = await api.getSnapshot(s.sessionId, 0);
    expect(res.status).toBe(200);
    expect(res.body.unchanged).toBe(false);
  });

  test('T2-FS2-05: GET ?sinceVersion=999999 returns unchanged or full snapshot cleanly without 500', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const res = await api.getSnapshot(s.sessionId, 999999);
    expect(res.status).toBe(200);
    expect(typeof res.body.unchanged).toBe('boolean');
  });

  // F-S3 (6 tests)
  test('T2-FS3-01: Join with empty label "" returns 400', async ({ request }) => {
    const api = new ExamQApiClient(request);
    const s = await api.createSession();
    const res = await api.joinStaff(s.body.sessionId, { label: '' });
    expect(res.status).toBe(400);
  });

  test('T2-FS3-02: Join with whitespace-only label returns 400', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await api.createSession();
    const res = await api.joinStaff(s.body.sessionId, { label: '   \t\n  ' });
    expect(res.status).toBe(400);
  });

  test('T2-FS3-03: Join with 41-character label exceeds 40-char limit and returns 400', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await api.createSession();
    const res = await api.joinStaff(s.body.sessionId, { label: 'A'.repeat(41) });
    expect(res.status).toBe(400);
  });

  test('T2-FS3-04: Join with 1-character label "A" succeeds with 200', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await api.createSession();
    const res = await api.joinStaff(s.body.sessionId, { label: 'A' });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('A');
  });

  test('T2-FS3-05: Join with exact 40-character label succeeds with 200', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await api.createSession();
    const label40 = 'P'.repeat(40);
    const res = await api.joinStaff(s.body.sessionId, { label: label40 });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe(label40);
  });

  test('T2-FS3-06: Join on nonexistent session returns 404', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const res = await api.joinStaff('missing-session-id', { label: 'Proctor' });
    expect(res.status).toBe(404);
  });

  // F-S4 (6 tests)
  test('T2-FS4-01: PATCH /config without x-controller-key returns 401 or 403', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await api.createSession();
    const res = await api.patchConfig(
      s.body.sessionId,
      null,
      allowedWindowConfig(),
    );
    expect([401, 403]).toContain(res.status);
  });

  test('T2-FS4-02: POST /entries with override=true and no key returns 401 or 403', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const res = await api.submitEntry(
      s.sessionId,
      {
        sex: 'M',
        studentNumber: 'UNAUTH-OVR',
        override: true,
      },
      null,
    );
    expect([401, 403]).toContain(res.status);
  });

  test('T2-FS4-03: POST /action without x-controller-key returns 401 or 403', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const entry = await api.submitEntry(s.sessionId, {
      sex: 'M',
      studentNumber: 'NOKEY-ACT',
    });

    const res = await api.entryAction(s.sessionId, entry.body.entry.id, null, {
      action: 'enter',
    });
    expect([401, 403]).toContain(res.status);
  });

  test('T2-FS4-04: POST /reorder without x-controller-key returns 401 or 403', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'R1' });
    const e2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'R2' });

    const res = await api.reorder(s.sessionId, null, {
      entryId: e2.body.entry.id,
      targetIndex: 0,
    });
    expect([401, 403]).toContain(res.status);
  });

  test('T2-FS4-05: POST /clear with wrong x-controller-key returns 401 or 403 and preserves entries', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'SAFE-1' });

    const res = await api.clear(s.sessionId, 'wrong-key-123');
    expect([401, 403]).toContain(res.status);

    const snap = await api.getSnapshot(s.sessionId);
    if (snap.body.unchanged) throw new Error('Expected snapshot');
    expect(snap.body.snapshot.entries).toHaveLength(1);
  });

  test('T2-FS4-06: Tampered ?key=invalid-key in browser URL does not grant controller privileges', async ({
    page,
    request,
  }) => {
    const errors = attachErrorGuards(page);
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    await page.goto(`/s/${s.sessionId}?key=tampered-invalid-key`);
    await expect(Selectors.clearSessionButton(page)).toHaveCount(0);
    await expect(Selectors.staffLabelInput(page)).toBeVisible();
    errors.assertZeroErrors();
  });
});
