import { expect, test } from '@playwright/test';
import {
  ExamQApiClient,
  allowedWindowConfig,
  createConfiguredSession,
} from './helpers/apiClient';
import { attachErrorGuards } from './helpers/layoutAudit';
import { verifyAndDecodeSessionQr } from './helpers/qrHelper';
import { Selectors } from './helpers/selectors';
import { ControllerPage, HomePage, StaffPage } from './helpers/sessionPages';

test.describe('Tier 1 — Session Access & Role Separation (F-S1..F-S4)', () => {
  // F-S1: Create Exam Session (5 tests)
  test('T1-FS1-01: POST /api/sessions returns 201 with sessionId, controllerKey, joinUrl, controllerUrl, and snapshot', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const res = await api.createSession();

    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBeTruthy();
    expect(res.body.controllerKey).toBeTruthy();
    expect(res.body.joinUrl).toContain(`/s/${res.body.sessionId}`);
    expect(res.body.controllerUrl).toContain(`/s/${res.body.sessionId}`);
    expect(res.body.snapshot.id).toBe(res.body.sessionId);
  });

  test('T1-FS1-02: Initial snapshot has version >= 1, empty entries/staff, null nextBySex, and UNCONFIGURED windowStatus', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const res = await api.createSession();

    expect(res.status).toBe(201);
    const snap = res.body.snapshot;
    expect(snap.version).toBeGreaterThanOrEqual(1);
    expect(snap.entries).toEqual([]);
    expect(snap.staff).toEqual([]);
    expect(snap.nextBySex).toEqual({ M: null, F: null });
    expect(snap.windowStatus).toBe('UNCONFIGURED');
    expect(snap.examConfig).toBeNull();
  });

  test('T1-FS1-03: Public snapshot and GET /api/sessions/[id] never expose controllerKey', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    expect(created.status).toBe(201);

    const key = created.body.controllerKey;
    expect(JSON.stringify(created.body.snapshot)).not.toContain(key);

    const getRes = await api.getSnapshot(created.body.sessionId);
    expect(getRes.status).toBe(200);
    expect(getRes.rawText).not.toContain(key);
  });

  test('T1-FS1-04: Clicking Create Exam Session on / navigates to Controller Dashboard with key', async ({
    page,
  }) => {
    const errors = attachErrorGuards(page);
    const home = new HomePage(page);
    await home.goto();

    const { sessionId, controllerKey } = await home.createSession();
    expect(sessionId).toBeTruthy();
    expect(controllerKey).toBeTruthy();
    await expect(Selectors.clearSessionButton(page)).toBeVisible();
    errors.assertZeroErrors();
  });

  test('T1-FS1-05: Two consecutive session creations via / produce distinct sessionIds and isolated state', async ({
    browser,
  }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    try {
      const p1 = await ctx1.newPage();
      const p2 = await ctx2.newPage();
      const h1 = new HomePage(p1);
      const h2 = new HomePage(p2);

      await h1.goto();
      const s1 = await h1.createSession();
      await h2.goto();
      const s2 = await h2.createSession();

      expect(s1.sessionId).not.toBe(s2.sessionId);
      expect(s1.controllerKey).not.toBe(s2.controllerKey);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  // F-S2: Shareable Link & QR Code (5 tests)
  test('T1-FS2-01: Controller Dashboard displays shareable /s/<sessionId> link without controllerKey', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await createConfiguredSession(api);

    const ctrl = new ControllerPage(page);
    await ctrl.goto(created.sessionId, created.controllerKey);

    const shareUrl = await ctrl.getShareUrl();
    expect(shareUrl).toContain(`/s/${created.sessionId}`);
    expect(shareUrl).not.toContain(created.controllerKey);
    expect(shareUrl).not.toContain('key=');
  });

  test('T1-FS2-02: Controller Dashboard renders visible QR element with non-zero bounding box', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await createConfiguredSession(api);

    const ctrl = new ControllerPage(page);
    await ctrl.goto(created.sessionId, created.controllerKey);

    const qr = Selectors.qrElement(page);
    await expect(qr).toBeVisible();
    const box = await qr.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(64);
    expect(box!.height).toBeGreaterThanOrEqual(64);
  });

  test('T1-FS2-03: Pure-TS QR decoder extracts valid /s/<sessionId> URL omitting controllerKey', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await createConfiguredSession(api);

    const ctrl = new ControllerPage(page);
    await ctrl.goto(created.sessionId, created.controllerKey);

    const decoded = await verifyAndDecodeSessionQr(
      page,
      Selectors.qrElement(page),
      created.sessionId,
      created.controllerKey,
    );
    expect(decoded).toContain(`/s/${created.sessionId}`);
  });

  test('T1-FS2-04: Opening QR-decoded URL in a fresh BrowserContext loads Roaming Staff Join screen', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await createConfiguredSession(api);

    const ctrlCtx = await browser.newContext();
    const staffCtx = await browser.newContext();
    try {
      const ctrlPage = await ctrlCtx.newPage();
      const ctrl = new ControllerPage(ctrlPage);
      await ctrl.goto(created.sessionId, created.controllerKey);

      const qrUrl = await verifyAndDecodeSessionQr(
        ctrlPage,
        Selectors.qrElement(ctrlPage),
        created.sessionId,
        created.controllerKey,
      );

      const staffPage = await staffCtx.newPage();
      await staffPage.goto(qrUrl);
      await expect(Selectors.staffLabelInput(staffPage)).toBeVisible();
      await expect(Selectors.clearSessionButton(staffPage)).toHaveCount(0);
    } finally {
      await ctrlCtx.close();
      await staffCtx.close();
    }
  });

  test('T1-FS2-05: API joinUrl contains /s/<id> without key while controllerUrl includes key', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    expect(created.status).toBe(201);

    const { sessionId, controllerKey, joinUrl, controllerUrl } = created.body;
    expect(joinUrl).toContain(`/s/${sessionId}`);
    expect(joinUrl).not.toContain(controllerKey);
    expect(joinUrl).not.toContain('key=');
    expect(controllerUrl).toContain(`/s/${sessionId}`);
    expect(controllerUrl).toContain(controllerKey);
  });

  // F-S3: Staff Join (No Account) (5 tests)
  test('T1-FS3-01: POST /api/sessions/[id]/join with valid label returns staffId, label, and updated staff list', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();

    const joined = await api.joinStaff(created.body.sessionId, {
      label: 'Hall A North Proctor',
    });
    expect(joined.status).toBe(200);
    expect(joined.body.staffId).toBeTruthy();
    expect(joined.body.label).toBe('Hall A North Proctor');
    expect(joined.body.snapshot.staff.length).toBe(1);
    expect(joined.body.snapshot.staff[0].label).toBe('Hall A North Proctor');
  });

  test('T1-FS3-02: Multiple roaming staff can join the same session with distinct staffIds', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();

    const j1 = await api.joinStaff(created.body.sessionId, {
      label: 'Proctor One',
    });
    const j2 = await api.joinStaff(created.body.sessionId, {
      label: 'Proctor Two',
    });
    expect(j1.status).toBe(200);
    expect(j2.status).toBe(200);
    expect(j1.body.staffId).not.toBe(j2.body.staffId);
    expect(j2.body.snapshot.staff.map((s) => s.label)).toEqual([
      'Proctor One',
      'Proctor Two',
    ]);
  });

  test('T1-FS3-03: Opening /s/<sessionId> prompts for name/label with zero password/account fields', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await createConfiguredSession(api);

    await page.goto(`/s/${created.sessionId}`);
    await expect(Selectors.staffLabelInput(page)).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
  });

  test('T1-FS3-04: Entering Proctor A and clicking Join transitions to Roaming Staff Queue view', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await createConfiguredSession(api);

    const staff = new StaffPage(page);
    await staff.goto(`/s/${created.sessionId}`);
    await staff.join('Proctor A');

    await expect(Selectors.studentNumberInput(page)).toBeVisible();
    await staff.expectWindowStatus(/allowed|open/i);
  });

  test('T1-FS3-05: Home page Join Existing Session flow navigates to /s/<sessionId> and completes onboarding', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await createConfiguredSession(api);

    const home = new HomePage(page);
    await home.goto();
    await home.joinByCode(created.sessionId);

    const staff = new StaffPage(page);
    await staff.join('Doorway Staff');
    await expect(Selectors.studentNumberInput(page)).toBeVisible();
  });

  // F-S4: Role Enforcement (5 tests)
  test('T1-FS4-01: Controller PATCH /config succeeds with valid x-controller-key', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();

    const cfg = allowedWindowConfig();
    const res = await api.patchConfig(
      created.body.sessionId,
      created.body.controllerKey,
      cfg,
    );
    expect(res.status).toBe(200);
    expect(res.body.snapshot.windowStatus).toBe('ALLOWED');
  });

  test('T1-FS4-02: Controller action, reorder, and clear all succeed with valid x-controller-key', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await createConfiguredSession(api);
    const sid = created.sessionId;
    const key = created.controllerKey;

    const s1 = await api.submitEntry(sid, { sex: 'M', studentNumber: '1001' });
    const s2 = await api.submitEntry(sid, { sex: 'M', studentNumber: '1002' });
    expect(s1.status).toBe(201);
    expect(s2.status).toBe(201);

    const reord = await api.reorder(sid, key, {
      entryId: s2.body.entry.id,
      targetIndex: 0,
    });
    expect(reord.status).toBe(200);
    expect(reord.body.snapshot.nextBySex.M).toBe(s2.body.entry.id);

    const act = await api.entryAction(sid, s2.body.entry.id, key, {
      action: 'enter',
    });
    expect(act.status).toBe(200);

    const clr = await api.clear(sid, key);
    expect(clr.status).toBe(200);
    expect(clr.body.snapshot.entries).toEqual([]);
  });

  test('T1-FS4-03: Controller URL /s/<id>?key=<key> stores controllerKey in sessionStorage and renders controller actions', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await createConfiguredSession(api);

    const ctrl = new ControllerPage(page);
    await ctrl.goto(created.sessionId, created.controllerKey);
    await expect(Selectors.clearSessionButton(page)).toBeVisible();
    await expect(Selectors.saveConfigButton(page)).toBeVisible();

    const stored = await page.evaluate(() => JSON.stringify(sessionStorage));
    expect(stored).toContain(created.controllerKey);
  });

  test('T1-FS4-04: Roaming staff view /s/<id> hides controller-only controls', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await createConfiguredSession(api);

    const staff = new StaffPage(page);
    await staff.goto(`/s/${created.sessionId}`);
    await staff.join('Proctor View Check');

    await expect(Selectors.clearSessionButton(page)).toHaveCount(0);
    await expect(Selectors.saveConfigButton(page)).toHaveCount(0);
    await expect(Selectors.overrideToggle(page)).toHaveCount(0);
  });

  test('T1-FS4-05: Roaming staff submission succeeds without x-controller-key inside ALLOWED window', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await createConfiguredSession(api);
    const joined = await api.joinStaff(created.sessionId, {
      label: 'Proctor B',
    });

    const res = await api.submitEntry(created.sessionId, {
      sex: 'F',
      studentNumber: '2044',
      staffId: joined.body.staffId,
      submittedBy: joined.body.label,
    });
    expect(res.status).toBe(201);
    expect(res.body.entry.studentNumber).toBe('2044');
    expect(res.body.entry.override).toBe(false);
  });
});
