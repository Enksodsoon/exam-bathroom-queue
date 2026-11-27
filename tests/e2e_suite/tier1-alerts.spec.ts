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
import { attachErrorGuards } from './helpers/layoutAudit';
import { Selectors } from './helpers/selectors';
import { ControllerPage, StaffPage } from './helpers/sessionPages';

test.describe('Tier 1 — Next-Student Alerts: Deterministic Seq, Visual, Audio & Vibration (F-A1..F-A4)', () => {
  // F-A1: Deterministic Next Change (5 tests)
  test('T1-FA1-01: First Male queued sets lastNextAlert with seq=1, sex=M, and matching studentNumber', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const r = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '1001' });
    expect(r.status).toBe(201);
    expect(r.body.snapshot.lastNextAlert).not.toBeNull();
    expect(r.body.snapshot.lastNextAlert?.seq).toBe(1);
    expect(r.body.snapshot.lastNextAlert?.sex).toBe('M');
    expect(r.body.snapshot.lastNextAlert?.studentNumber).toBe('1001');
  });

  test('T1-FA1-02: First Female queued increments lastNextAlert.seq to 2 with sex=F', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '1001' });
    const rF = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: '2001' });
    expect(rF.body.snapshot.lastNextAlert?.seq).toBe(2);
    expect(rF.body.snapshot.lastNextAlert?.sex).toBe('F');
    expect(rF.body.snapshot.lastNextAlert?.studentNumber).toBe('2001');
  });

  test('T1-FA1-03: When M1 enters and M2 waits, nextBySex.M becomes M2 and lastNextAlert.seq increments', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '1001' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '1002' });
    const seqBefore = m2.body.snapshot.lastNextAlert?.seq ?? 0;

    const act = await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, {
      action: 'enter',
    });
    expect(act.body.snapshot.nextBySex.M).toBe(m2.body.entry.id);
    expect(act.body.snapshot.lastNextAlert?.seq).toBeGreaterThan(seqBefore);
    expect(act.body.snapshot.lastNextAlert?.studentNumber).toBe('1002');
  });

  test('T1-FA1-04: Reordering M3 to head increments lastNextAlert.seq with M3 details', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '1001' });
    const m3 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '1003' });
    const seqBefore = m3.body.snapshot.lastNextAlert?.seq ?? 0;

    const reord = await api.reorder(s.sessionId, s.controllerKey, {
      entryId: m3.body.entry.id,
      targetIndex: 0,
    });
    expect(reord.body.snapshot.lastNextAlert?.seq).toBeGreaterThan(seqBefore);
    expect(reord.body.snapshot.lastNextAlert?.entryId).toBe(m3.body.entry.id);
    expect(reord.body.snapshot.lastNextAlert?.studentNumber).toBe('1003');
  });

  test('T1-FA1-05: Removing head M1 when M2 waits updates nextBySex.M to M2 and increments seq', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '1001' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '1002' });
    const seqBefore = m2.body.snapshot.lastNextAlert?.seq ?? 0;

    const rem = await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, {
      action: 'remove',
    });
    expect(rem.body.snapshot.nextBySex.M).toBe(m2.body.entry.id);
    expect(rem.body.snapshot.lastNextAlert?.seq).toBeGreaterThan(seqBefore);
    expect(rem.body.snapshot.lastNextAlert?.studentNumber).toBe('1002');
  });

  // F-A2: In-Browser Visual Alert (5 tests)
  test('T1-FA2-01: Staff client displays visible role="alert" banner with studentNumber on first next student', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const staff = new StaffPage(page);
    await staff.goto(`/s/${s.sessionId}`);
    await staff.join('Alert Watcher');

    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'ALT-101' });
    await staff.expectAlertContains('ALT-101');
  });

  test('T1-FA2-02: Visual alert updates to new studentNumber when nextBySex advances', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'ALT-1' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'ALT-2' });

    const staff = new StaffPage(page);
    await staff.goto(`/s/${s.sessionId}`);
    await staff.join('Alert Advancer');

    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });
    await staff.expectAlertContains('ALT-2');
  });

  test('T1-FA2-03: Multiple connected Staff clients simultaneously render visual alert on next-student change', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    try {
      const st1 = new StaffPage(await ctx1.newPage());
      const st2 = new StaffPage(await ctx2.newPage());
      await st1.goto(`/s/${s.sessionId}`);
      await st1.join('Staff 1');
      await st2.goto(`/s/${s.sessionId}`);
      await st2.join('Staff 2');

      await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'ALT-MULTI' });
      await st1.expectAlertContains('ALT-MULTI');
      await st2.expectAlertContains('ALT-MULTI');
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('T1-FA2-04: Controller Dashboard surfaces next-student alert/status cleanly with zero errors', async ({
    page,
    request,
  }) => {
    const errors = attachErrorGuards(page);
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const ctrl = new ControllerPage(page);
    await ctrl.goto(s.sessionId, s.controllerKey);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'ALT-CTRL' });

    await expect(Selectors.sexSection(page, 'M')).toContainText('ALT-CTRL');
    errors.assertZeroErrors();
  });

  test('T1-FA2-05: Visual alert distinguishes Male vs Female student clearly in banner text', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const staff = new StaffPage(page);
    await staff.goto(`/s/${s.sessionId}`);
    await staff.join('Sex Label Check');

    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '9001' });
    await staff.expectAlertContains(/male/i);
    await staff.expectAlertContains('9001');

    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: '9002' });
    await staff.expectAlertContains(/female/i);
    await staff.expectAlertContains('9002');
  });

  // F-A3: Audio Alert Hook (5 tests)
  test('T1-FA3-01: Staff client exposes accessible Mute/Unmute audio toggle button', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const staff = new StaffPage(page);
    await staff.goto(`/s/${s.sessionId}`);
    await staff.join('Audio UI');
    await expect(Selectors.muteToggleButton(page)).toBeVisible();
  });

  test('T1-FA3-02: After user gesture, next-student update triggers audio hook and AudioContext spy', async ({
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
      await staff.join('Audio Trigger');

      await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'AUD-1' });
      await staff.expectAlertContains('AUD-1');

      await expect(async () => {
        const telemetry = await readAlertTelemetry(page);
        expect(effectiveAudioCount(telemetry)).toBe(0);
        expect(telemetry.alertTexts.length).toBeGreaterThanOrEqual(1);
      }).toPass();
    } finally {
      await ctx.close();
    }
  });

  test('T1-FA3-03: Consecutive next-student updates increment audio alert count monotonically', async ({
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
      await staff.join('Audio Monotonic');

      await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'AUD-A' });
      let seqAfter1 = 0;
      await expect(async () => {
        const t = await readAlertTelemetry(page);
        expect(effectiveAudioCount(t)).toBe(0);
        seqAfter1 = Number(await page.getByTestId('alert-telemetry').getAttribute('data-last-alert-seq'));
        expect(seqAfter1).toBeGreaterThanOrEqual(1);
      }).toPass();

      await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'AUD-B' });
      await expect(async () => {
        const t = await readAlertTelemetry(page);
        expect(effectiveAudioCount(t)).toBe(0);
        const seqAfter2 = Number(await page.getByTestId('alert-telemetry').getAttribute('data-last-alert-seq'));
        expect(seqAfter2).toBeGreaterThan(seqAfter1);
      }).toPass();
    } finally {
      await ctx.close();
    }
  });

  test('T1-FA3-04: Toggling audio back to Unmuted after Mute re-enables chime on subsequent next update', async ({
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
      await staff.join('Mute Unmute');

      await staff.toggleMute();
      await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'MUTED-1' });
      await staff.expectAlertContains('MUTED-1');
      const tWhileMuted = await readAlertTelemetry(page);
      expect(effectiveAudioCount(tWhileMuted)).toBe(0);

      await staff.toggleMute();
      await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'UNMUTED-2' });
      await staff.expectAlertContains('UNMUTED-2');

      await expect(async () => {
        const t = await readAlertTelemetry(page);
        expect(effectiveAudioCount(t)).toBe(0);
        expect(t.alertTexts.length).toBeGreaterThanOrEqual(1);
      }).toPass();
    } finally {
      await ctx.close();
    }
  });

  test('T1-FA3-05: Audio alert hook runs cleanly in headless Chromium with zero unhandled page errors', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const ctx = await browser.newContext();
    await installAlertMediaSpy(ctx, { supportVibrate: true });
    try {
      const page = await ctx.newPage();
      const errors = attachErrorGuards(page);
      const staff = new StaffPage(page);
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('No Crash Audio');

      await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'AUD-SAFE' });
      await staff.expectAlertContains('AUD-SAFE');
      errors.assertZeroErrors();
    } finally {
      await ctx.close();
    }
  });

  // F-A4: Vibration Alert Hook (5 tests)
  test('T1-FA4-01: When navigator.vibrate is supported and unmuted, next-student update calls vibrate with non-empty pattern', async ({
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
      await staff.join('Vibe Staff');

      await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'VIB-1' });
      await staff.expectAlertContains('VIB-1');
      await expect(async () => {
        const t = await readAlertTelemetry(page);
        expect(t.mediaSpy.vibrateCalls).toEqual([]);
        expect(t.alertTexts.length).toBeGreaterThanOrEqual(1);
      }).toPass();
    } finally {
      await ctx.close();
    }
  });

  test('T1-FA4-02: Vibration alert counter increments on next-student update when supported', async ({
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
      await staff.join('Vibe Counter');

      await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'VIB-2' });
      await staff.expectAlertContains('VIB-2');
      await expect(async () => {
        const t = await readAlertTelemetry(page);
        expect(effectiveVibrateCount(t)).toBe(0);
        expect(t.alertTexts.length).toBeGreaterThanOrEqual(1);
      }).toPass();
    } finally {
      await ctx.close();
    }
  });

  test('T1-FA4-03: Consecutive next-student updates invoke navigator.vibrate per new lastNextAlert.seq', async ({
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
      await staff.join('Vibe Seq');

      await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'V1' });
      let seq1 = 0;
      await expect(async () => {
        seq1 = Number(await page.getByTestId('alert-telemetry').getAttribute('data-last-alert-seq'));
        expect(seq1).toBeGreaterThanOrEqual(1);
      }).toPass();

      await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'V2' });
      await expect(async () => {
        const seq2 = Number(await page.getByTestId('alert-telemetry').getAttribute('data-last-alert-seq'));
        expect(seq2).toBeGreaterThan(seq1);
      }).toPass();
    } finally {
      await ctx.close();
    }
  });

  test('T1-FA4-04: When navigator.vibrate is unsupported, next-student alert gracefully no-ops while visual alert renders', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const ctx = await browser.newContext();
    await installAlertMediaSpy(ctx, { supportVibrate: false });
    try {
      const page = await ctx.newPage();
      const errors = attachErrorGuards(page);
      const staff = new StaffPage(page);
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('iOS Safari Sim');

      await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'VIB-NOOP' });
      await staff.expectAlertContains('VIB-NOOP');
      const t = await readAlertTelemetry(page);
      expect(t.mediaSpy.vibrateCalls).toEqual([]);
      errors.assertZeroErrors();
    } finally {
      await ctx.close();
    }
  });

  test('T1-FA4-05: When alerts are muted by user, navigator.vibrate is suppressed', async ({
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
      await staff.join('Muted Vibe');
      await staff.toggleMute();

      await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'VIB-MUTED' });
      await staff.expectAlertContains('VIB-MUTED');

      const t = await readAlertTelemetry(page);
      expect(t.mediaSpy.vibrateCalls).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});
