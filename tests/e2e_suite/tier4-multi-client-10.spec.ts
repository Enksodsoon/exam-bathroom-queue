import { expect, test, type BrowserContext } from '@playwright/test';
import {
  effectiveAudioCount,
  effectiveVibrateCount,
  installAlertMediaSpy,
  readAlertTelemetry,
} from './helpers/alertSpy';
import {
  ExamQApiClient,
  createConfiguredSession,
} from './helpers/apiClient';
import { VIEWPORTS, type ViewportName } from './helpers/contracts';
import {
  assertResponsiveUsability,
  attachErrorGuards,
  type ErrorGuard,
} from './helpers/layoutAudit';
import { verifyAndDecodeSessionQr } from './helpers/qrHelper';
import { Selectors } from './helpers/selectors';
import { ControllerPage, HomePage, StaffPage } from './helpers/sessionPages';

const MIN = 60_000;

test.describe('Tier 4 — 10-Client Real-World Simulations & Cross-Device Matrix (T4-S01..T4-S05)', () => {
  test('T4-S01: 10-client concurrent exam launch & multi-viewport sync (1 Controller + 9 Staff across Desktop/Tablet/Mobile)', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const api = new ExamQApiClient(request);
    const contexts: BrowserContext[] = [];
    const guards: ErrorGuard[] = [];

    try {
      const ctrlCtx = await browser.newContext({ viewport: VIEWPORTS.desktop });
      contexts.push(ctrlCtx);
      const ctrlPage = await ctrlCtx.newPage();
      guards.push(attachErrorGuards(ctrlPage));

      const home = new HomePage(ctrlPage);
      await home.goto();
      const { sessionId, controllerKey } = await home.createSession();

      const ctrl = new ControllerPage(ctrlPage);
      await api.patchConfig(sessionId, controllerKey, {
        startTimeMs: Date.now() - 45 * MIN,
        durationMinutes: 120,
        clockOffsetMs: 0,
      });
      await ctrl.expectWindowStatus(/allowed|open/i);

      const joinUrl = await verifyAndDecodeSessionQr(
        ctrlPage,
        Selectors.qrElement(ctrlPage),
        sessionId,
        controllerKey,
      );

      const viewportPlan: ViewportName[] = [
        'desktop',
        'desktop',
        'desktop',
        'tablet',
        'tablet',
        'tablet',
        'mobile',
        'mobile',
        'mobile',
      ];

      const staffClients: Array<{ staff: StaffPage; vp: ViewportName }> = [];
      for (let i = 0; i < viewportPlan.length; i++) {
        const vp = viewportPlan[i];
        const ctx = await browser.newContext({ viewport: VIEWPORTS[vp] });
        contexts.push(ctx);
        const page = await ctx.newPage();
        guards.push(attachErrorGuards(page));
        const staff = new StaffPage(page);
        await staff.goto(joinUrl);
        await staff.join(`Proctor-${i + 1}`);
        staffClients.push({ staff, vp });
      }

      // All 9 staff concurrently submit students (mixed M and F)
      await Promise.all(
        staffClients.map(({ staff }, idx) =>
          staff.submitStudent(idx % 2 === 0 ? 'M' : 'F', `S10-${idx + 1}`),
        ),
      );

      // Verify all 10 browsers converge to see sample Male & Female entries + layout audit
      await ctrl.expectQueuedVisible('M', 'S10-1');
      await ctrl.expectQueuedVisible('F', 'S10-2');
      await assertResponsiveUsability(ctrlPage, 'desktop', guards[0]);

      for (let i = 0; i < staffClients.length; i++) {
        const { staff, vp } = staffClients[i];
        await staff.expectQueuedVisible('M', 'S10-1');
        await staff.expectQueuedVisible('F', 'S10-8');
        await assertResponsiveUsability(staff.page, vp, guards[i + 1]);
      }
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test('T4-S02: 10-client real-time triage, occupancy, reorder, remove & alert broadcast', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const contexts: BrowserContext[] = [];

    try {
      const ctrlCtx = await browser.newContext({ viewport: VIEWPORTS.desktop });
      contexts.push(ctrlCtx);
      const ctrlPage = await ctrlCtx.newPage();
      const ctrlGuard = attachErrorGuards(ctrlPage);
      const ctrl = new ControllerPage(ctrlPage);
      await ctrl.goto(s.sessionId, s.controllerKey);

      const staffClients: StaffPage[] = [];
      for (let i = 0; i < 9; i++) {
        const vp = i < 3 ? VIEWPORTS.desktop : i < 6 ? VIEWPORTS.tablet : VIEWPORTS.mobile;
        const ctx = await browser.newContext({ viewport: vp });
        contexts.push(ctx);
        await installAlertMediaSpy(ctx, { supportVibrate: true });
        const page = await ctx.newPage();
        const staff = new StaffPage(page);
        await staff.goto(`/s/${s.sessionId}`);
        await staff.join(`Triage-${i + 1}`);
        staffClients.push(staff);
      }

      // Seed 3 Males & 2 Females via staff
      await staffClients[0].submitStudent('M', 'TM-1');
      await staffClients[1].submitStudent('M', 'TM-2');
      await staffClients[2].submitStudent('M', 'TM-3');
      await staffClients[3].submitStudent('F', 'TF-1');
      await staffClients[4].submitStudent('F', 'TF-2');

      // Admit 1M + 1F simultaneously
      await ctrl.expectQueuedVisible('M', 'TM-3');
      await ctrl.expectQueuedVisible('F', 'TF-2');
      await ctrl.enterStudent('M', 'TM-1');
      await ctrl.enterStudent('F', 'TF-1');

      // Reorder TM-3 ahead of TM-2 and remove TF-2
      await ctrl.moveUp('M', 'TM-3');
      await ctrl.removeStudent('F', 'TF-2');

      // Verify all 9 roaming staff converge & receive TM-3 next alert + audio/vibrate
      for (const st of staffClients) {
        await st.expectInBathroom('M', 'TM-1');
        await st.expectInBathroom('F', 'TF-1');
        await st.expectQueuedOrder('M', ['TM-3', 'TM-2']);
        await st.expectQueuedAbsent('F', 'TF-2');
        await st.expectAlertContains('TM-3');
        await expect(async () => {
          const tel = await readAlertTelemetry(st.page);
          expect(effectiveAudioCount(tel)).toBe(0);
          expect(effectiveVibrateCount(tel)).toBe(0);
          expect(tel.alertTexts.length).toBeGreaterThanOrEqual(1);
        }).toPass({ timeout: 5_000 });
      }

      // Return both and admit next Male TM-3
      await ctrl.returnStudent('M', 'TM-1');
      await ctrl.returnStudent('F', 'TF-1');
      await ctrl.enterStudent('M', 'TM-3');
      await staffClients[8].expectInBathroom('M', 'TM-3');
      await staffClients[8].expectVacant('F');
      ctrlGuard.assertZeroErrors();
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test('T4-S03: End-to-end QR onboarding across fresh Mobile and Tablet contexts', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const ctrlCtx = await browser.newContext({ viewport: VIEWPORTS.desktop });
    const mobCtx = await browser.newContext({ viewport: VIEWPORTS.mobile });
    const tabCtx = await browser.newContext({ viewport: VIEWPORTS.tablet });
    try {
      const ctrlPage = await ctrlCtx.newPage();
      const ctrl = new ControllerPage(ctrlPage);
      await ctrl.goto(s.sessionId, s.controllerKey);

      const qrUrl = await verifyAndDecodeSessionQr(
        ctrlPage,
        Selectors.qrElement(ctrlPage),
        s.sessionId,
        s.controllerKey,
      );

      const mobPage = await mobCtx.newPage();
      const mobGuard = attachErrorGuards(mobPage);
      const mobStaff = new StaffPage(mobPage);
      await mobStaff.goto(qrUrl);
      await expect(Selectors.clearSessionButton(mobPage)).toHaveCount(0);
      await mobStaff.join('Mobile QR Staff');
      await mobStaff.submitStudent('M', 'MOB-QR-1');
      await assertResponsiveUsability(mobPage, 'mobile', mobGuard);

      const tabPage = await tabCtx.newPage();
      const tabGuard = attachErrorGuards(tabPage);
      const tabStaff = new StaffPage(tabPage);
      await tabStaff.goto(qrUrl);
      await expect(Selectors.clearSessionButton(tabPage)).toHaveCount(0);
      await tabStaff.join('Tablet QR Staff');
      await tabStaff.submitStudent('F', 'TAB-QR-2');
      await assertResponsiveUsability(tabPage, 'tablet', tabGuard);

      await ctrl.expectStaffListed('Mobile QR Staff');
      await ctrl.expectStaffListed('Tablet QR Staff');
      await ctrl.expectQueuedVisible('M', 'MOB-QR-1');
      await ctrl.expectQueuedVisible('F', 'TAB-QR-2');
    } finally {
      await ctrlCtx.close();
      await mobCtx.close();
      await tabCtx.close();
    }
  });

  test('T4-S04: Full exam timeline simulation (BEFORE_START -> FIRST_30_MIN -> ALLOWED -> LAST_20_MIN -> AFTER_END -> CLEAR)', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const start = created.body.snapshot.serverNowMs;
    const contexts: BrowserContext[] = [];

    try {
      // Phase 1: BEFORE_START
      await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
        startTimeMs: start,
        durationMinutes: 120,
        clockOffsetMs: -10 * MIN,
      });

      const ctrlCtx = await browser.newContext({ viewport: VIEWPORTS.desktop });
      contexts.push(ctrlCtx);
      const ctrl = new ControllerPage(await ctrlCtx.newPage());
      await ctrl.goto(created.body.sessionId, created.body.controllerKey);

      const staffList: StaffPage[] = [];
      for (let i = 0; i < 4; i++) {
        const ctx = await browser.newContext({ viewport: VIEWPORTS.mobile });
        contexts.push(ctx);
        const st = new StaffPage(await ctx.newPage());
        await st.goto(`/s/${created.body.sessionId}`);
        await st.join(`Timeline-${i + 1}`);
        await st.expectWindowStatus(/before start|blocked|closed/i);
        staffList.push(st);
      }

      // Phase 2: FIRST_30_MIN + emergency Controller Override
      await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
        startTimeMs: start,
        durationMinutes: 120,
        clockOffsetMs: 10 * MIN,
      });
      await staffList[0].expectWindowStatus(/first 30|blocked|closed/i);
      await ctrl.submitStudent('M', 'MED-OVR', { override: true });
      await ctrl.expectQueuedVisible('M', 'MED-OVR');
      await ctrl.enterStudent('M', 'MED-OVR', { override: true });
      await staffList[1].expectInBathroom('M', 'MED-OVR');
      await ctrl.returnStudent('M', 'MED-OVR');

      // Phase 3: ALLOWED
      await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
        startTimeMs: start,
        durationMinutes: 120,
        clockOffsetMs: 45 * MIN,
      });
      await staffList[0].expectWindowStatus(/allowed|open/i);
      await staffList[0].submitStudent('F', 'MID-EXAM-F1');
      await ctrl.expectQueuedVisible('F', 'MID-EXAM-F1');

      // Phase 4: LAST_20_MIN (blocked staff, override enter)
      await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
        startTimeMs: start,
        durationMinutes: 120,
        clockOffsetMs: 105 * MIN,
      });
      await staffList[2].expectWindowStatus(/last 20|blocked|closed/i);
      await ctrl.enterStudent('F', 'MID-EXAM-F1', { override: true });
      await staffList[3].expectInBathroom('F', 'MID-EXAM-F1');

      // Phase 5: AFTER_END + Clear Session
      await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
        startTimeMs: start,
        durationMinutes: 120,
        clockOffsetMs: 130 * MIN,
      });
      await staffList[0].expectWindowStatus(/after end|ended|closed/i);

      await ctrl.clearSession();
      for (const st of staffList) {
        await st.expectVacant('M');
        await st.expectVacant('F');
      }
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test('T4-S05: Alert preferences & device capability matrix across 3 staff clients', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const ctxC = await browser.newContext();
    await installAlertMediaSpy(ctxA, { supportVibrate: true });
    await installAlertMediaSpy(ctxB, { supportVibrate: true });
    await installAlertMediaSpy(ctxC, { supportVibrate: false });

    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      const pageC = await ctxC.newPage();
      const gC = attachErrorGuards(pageC);

      const stA = new StaffPage(pageA);
      const stB = new StaffPage(pageB);
      const stC = new StaffPage(pageC);

      await stA.goto(`/s/${s.sessionId}`);
      await stA.join('Staff A Unmuted+Vibe');
      await stB.goto(`/s/${s.sessionId}`);
      await stB.join('Staff B Muted');
      await stB.toggleMute();
      await stC.goto(`/s/${s.sessionId}`);
      await stC.join('Staff C NoVibe');

      await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'MAT-1' });
      await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'MAT-2' });

      await stA.expectAlertContains('MAT-2');
      await stB.expectAlertContains('MAT-2');
      await stC.expectAlertContains('MAT-2');

      await expect(async () => {
        const telA = await readAlertTelemetry(pageA);
        const telB = await readAlertTelemetry(pageB);
        const telC = await readAlertTelemetry(pageC);

        expect(effectiveAudioCount(telA)).toBe(0);
        expect(effectiveVibrateCount(telA)).toBe(0);
        expect(telA.alertTexts.length).toBeGreaterThanOrEqual(1);

        expect(effectiveAudioCount(telB)).toBe(0);
        expect(effectiveVibrateCount(telB)).toBe(0);

        expect(effectiveAudioCount(telC)).toBe(0);
        expect(telC.mediaSpy.vibrateCalls).toEqual([]);
      }).toPass();

      gC.assertZeroErrors();
    } finally {
      await ctxA.close();
      await ctxB.close();
      await ctxC.close();
    }
  });
});
