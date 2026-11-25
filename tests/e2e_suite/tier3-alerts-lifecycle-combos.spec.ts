import { expect, test } from '@playwright/test';
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
import { ControllerPage, StaffPage } from './helpers/sessionPages';

const MIN = 60_000;

test.describe('Tier 3 — Alerts, Lifecycle, Mute & Sync Edge Combinations (T3-18..T3-24)', () => {
  test('T3-18 (F-T4 x F-Q3 x F-Q8): Clear Session wipes 1M+1F in_bathroom, 3 queued, and 2 returned across clients', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const r1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'RET-1' });
    const r2 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'RET-2' });
    await api.entryAction(s.sessionId, r1.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, r1.body.entry.id, s.controllerKey, { action: 'return' });
    await api.entryAction(s.sessionId, r2.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, r2.body.entry.id, s.controllerKey, { action: 'return' });

    const aM = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'ACT-M' });
    const aF = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'ACT-F' });
    await api.entryAction(s.sessionId, aM.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, aF.body.entry.id, s.controllerKey, { action: 'enter' });

    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'Q-1' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'Q-2' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'Q-3' });

    const cCtx = await browser.newContext();
    const sCtx = await browser.newContext();
    try {
      const ctrl = new ControllerPage(await cCtx.newPage());
      const staff = new StaffPage(await sCtx.newPage());
      await ctrl.goto(s.sessionId, s.controllerKey);
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('Clear Tester');

      await staff.expectInBathroom('M', 'ACT-M');
      await staff.expectInBathroom('F', 'ACT-F');

      await ctrl.clearSession();
      await staff.expectVacant('M');
      await staff.expectVacant('F');
      await staff.expectQueuedAbsent('M', 'Q-1');
      await staff.expectQueuedAbsent('F', 'Q-3');
    } finally {
      await cCtx.close();
      await sCtx.close();
    }
  });

  test('T3-19 (F-T4 x F-Q2 x F-A1): After Clear Session, re-submitting previously active student succeeds and fires new alert', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'CYCLE-77' });
    await api.entryAction(s.sessionId, m.body.entry.id, s.controllerKey, { action: 'enter' });

    const clr = await api.clear(s.sessionId, s.controllerKey);
    const seqAfterClear = clr.body.snapshot.lastNextAlert?.seq ?? 0;

    const re = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'CYCLE-77' });
    expect(re.status).toBe(201);
    expect(re.body.snapshot.lastNextAlert?.seq).toBeGreaterThan(seqAfterClear);
    expect(re.body.snapshot.lastNextAlert?.studentNumber).toBe('CYCLE-77');
  });

  test('T3-20 (F-A2 x F-A3 x F-A4): Mute ON -> visual only; Mute OFF -> next update triggers audio and vibrate', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const ctx = await browser.newContext();
    await installAlertMediaSpy(ctx, { supportVibrate: true });
    try {
      const page = await ctx.newPage();
      const staff = new StaffPage(page);
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('Toggle Audio Vibe');

      await staff.toggleMute();
      await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'MUTE-1' });
      await staff.expectAlertContains('MUTE-1');
      const muted = await readAlertTelemetry(page);
      expect(effectiveAudioCount(muted)).toBe(0);
      expect(effectiveVibrateCount(muted)).toBe(0);

      await staff.toggleMute();
      await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'UNMUTE-2' });
      await staff.expectAlertContains('UNMUTE-2');
      await expect(async () => {
        const unmuted = await readAlertTelemetry(page);
        expect(effectiveAudioCount(unmuted)).toBeGreaterThanOrEqual(1);
        expect(effectiveVibrateCount(unmuted)).toBeGreaterThanOrEqual(1);
      }).toPass();
    } finally {
      await ctx.close();
    }
  });

  test('T3-21 (F-A1 x F-A2): Dual-sex next changes (Male head then Female head) update Staff alert banner accurately', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const staff = new StaffPage(page);
    await staff.goto(`/s/${s.sessionId}`);
    await staff.join('Dual Sex Alert');

    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'DUAL-M' });
    await staff.expectAlertContains('DUAL-M');

    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'DUAL-F' });
    await staff.expectAlertContains('DUAL-F');
  });

  test('T3-22 (F-Q8 hidden-tab recovery): Hidden staff tab catches up cleanly after 3 mutations', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const ctx = await browser.newContext();
    try {
      const staffPage = await ctx.newPage();
      await staffPage.addInitScript(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        });
      });
      const staff = new StaffPage(staffPage);
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('Hidden Tab Staff');

      const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'HID-1' });
      await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'HID-2' });
      await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });

      await expect(async () => {
        await staff.expectInBathroom('M', 'HID-1');
        await staff.expectQueuedVisible('M', 'HID-2');
      }).toPass({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });

  test('T3-23 (F-S3 x F-Q8): Two tabs in same BrowserContext plus third isolated context converge identically', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const sameCtx = await browser.newContext();
    const otherCtx = await browser.newContext();
    try {
      const tab1 = new StaffPage(await sameCtx.newPage());
      const tab2 = new StaffPage(await sameCtx.newPage());
      const tab3 = new StaffPage(await otherCtx.newPage());

      await tab1.goto(`/s/${s.sessionId}`);
      await tab1.join('SameCtx Tab 1');
      await tab2.goto(`/s/${s.sessionId}`);
      // tab2 may already have sessionStorage from tab1 in the same BrowserContext
      const needsJoin = await tab2.page
        .getByLabel(/name|label/i)
        .isVisible()
        .catch(() => false);
      if (needsJoin) {
        await tab2.join('SameCtx Tab 2');
      }
      await tab3.goto(`/s/${s.sessionId}`);
      await tab3.join('Isolated Tab 3');

      await tab1.submitStudent('F', 'BC-SYNC-1');
      await tab2.expectQueuedVisible('F', 'BC-SYNC-1');
      await tab3.expectQueuedVisible('F', 'BC-SYNC-1');
    } finally {
      await sameCtx.close();
      await otherCtx.close();
    }
  });

  test('T3-24 (F-T3 x F-Q5): Student added & entered via override in FIRST_30_MIN returns normally in ALLOWED window', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const start = created.body.snapshot.serverNowMs;
    await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
      startTimeMs: start,
      durationMinutes: 120,
      clockOffsetMs: 5 * MIN,
    });

    const added = await api.submitEntry(
      created.body.sessionId,
      { sex: 'M', studentNumber: 'OVR-TO-NORM', override: true },
      created.body.controllerKey,
    );
    await api.entryAction(
      created.body.sessionId,
      added.body.entry.id,
      created.body.controllerKey,
      { action: 'enter', override: true },
    );

    await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
      startTimeMs: start,
      durationMinutes: 120,
      clockOffsetMs: 45 * MIN,
    });

    const ret = await api.entryAction(
      created.body.sessionId,
      added.body.entry.id,
      created.body.controllerKey,
      { action: 'return' },
    );
    expect(ret.status).toBe(200);
    expect(
      ret.body.snapshot.entries.find((e) => e.id === added.body.entry.id)?.status,
    ).toBe('returned');
  });
});
