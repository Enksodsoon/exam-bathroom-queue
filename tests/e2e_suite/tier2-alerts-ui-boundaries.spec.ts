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
import { VIEWPORTS } from './helpers/contracts';
import {
  assertResponsiveUsability,
  attachErrorGuards,
} from './helpers/layoutAudit';
import { Selectors } from './helpers/selectors';
import { StaffPage } from './helpers/sessionPages';

test.describe('Tier 2 — Alerts & Cross-Device UI Boundaries (F-A1..F-A4, F-D1)', () => {
  // F-A1..F-A4 (6 tests)
  test('T2-FA-01: Adding 2nd queued student behind M1 does NOT increment lastNextAlert.seq', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const r1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const seq1 = r1.body.snapshot.lastNextAlert?.seq;
    expect(seq1).toBe(1);

    const r2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });
    expect(r2.body.snapshot.lastNextAlert?.seq).toBe(seq1);
  });

  test('T2-FA-02: Removing non-head queued entry M2 does NOT increment lastNextAlert.seq', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });
    const seqBefore = m2.body.snapshot.lastNextAlert?.seq;

    const rem = await api.entryAction(s.sessionId, m2.body.entry.id, s.controllerKey, {
      action: 'remove',
    });
    expect(rem.body.snapshot.lastNextAlert?.seq).toBe(seqBefore);
  });

  test('T2-FA-03: Returning M1 when queue is empty does NOT fire spurious next-student alert', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const seqBefore = m1.body.snapshot.lastNextAlert?.seq;

    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });
    const ret = await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, {
      action: 'return',
    });
    expect(ret.body.snapshot.nextBySex.M).toBeNull();
    expect(ret.body.snapshot.lastNextAlert?.seq).toBe(seqBefore);
  });

  test('T2-FA-04: Muted state suppresses audio and vibrate while still rendering visual role="alert"', async ({
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
      await staff.join('Muted Visual Check');
      await staff.toggleMute();

      await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'VIS-ONLY' });
      await staff.expectAlertContains('VIS-ONLY');

      const t = await readAlertTelemetry(page);
      expect(effectiveAudioCount(t)).toBe(0);
      expect(effectiveVibrateCount(t)).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  test('T2-FA-05: Unsupported navigator.vibrate (undefined) never throws while audio and visual alerts work', async ({
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
      await staff.join('No Vibrate Device');

      await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'AUD-NO-VIB' });
      await staff.expectAlertContains('AUD-NO-VIB');

      await expect(async () => {
        const t = await readAlertTelemetry(page);
        expect(effectiveAudioCount(t)).toBeGreaterThanOrEqual(1);
        expect(t.mediaSpy.vibrateCalls).toEqual([]);
      }).toPass();
      errors.assertZeroErrors();
    } finally {
      await ctx.close();
    }
  });

  test('T2-FA-06: Two rapid consecutive head changes converge cleanly to latest alert on Staff UI', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const staff = new StaffPage(page);
    await staff.goto(`/s/${s.sessionId}`);
    await staff.join('Rapid Alert');

    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'R-1' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'R-2' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });

    await staff.expectAlertContains('R-2');
  });

  // F-D1 UI Boundaries (5 tests)
  test('T2-FD1-01: 40-char staff label and 20-char studentNumber on 375x667 mobile cause zero overflow', async ({
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
      await staff.join('L'.repeat(40));
      await staff.submitStudent('M', 'STU-1234567890123456');

      await staff.expectQueuedVisible('M', 'STU-1234567890123456');
      await assertResponsiveUsability(page, 'mobile', errors);
    } finally {
      await ctx.close();
    }
  });

  test('T2-FD1-02: 20-item queue on 375x667 mobile maintains zero horizontal overflow and usable controls', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    for (let i = 1; i <= 10; i++) {
      await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: `M-${i}` });
      await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: `F-${i}` });
    }

    const ctx = await browser.newContext({ viewport: VIEWPORTS.mobile });
    try {
      const page = await ctx.newPage();
      const errors = attachErrorGuards(page);
      const staff = new StaffPage(page);
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('Long List Staff');
      await assertResponsiveUsability(page, 'mobile', errors);
    } finally {
      await ctx.close();
    }
  });

  test('T2-FD1-03: Rapid double-submission in Staff UI does not crash or create duplicate entries', async ({
    page,
    request,
  }) => {
    const errors = attachErrorGuards(page);
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const staff = new StaffPage(page);
    await staff.goto(`/s/${s.sessionId}`);
    await staff.join('Double Clicker');

    await staff.selectSex('M');
    await Selectors.studentNumberInput(page).fill('DBL-99');
    const btn = Selectors.submitStudentButton(page);
    await Promise.all([btn.click(), btn.click().catch(() => undefined)]);

    await staff.expectQueuedVisible('M', 'DBL-99');
    const snap = await api.getSnapshot(s.sessionId);
    if (snap.body.unchanged) throw new Error('Expected snapshot');
    const matches = snap.body.snapshot.entries.filter(
      (e) => e.studentNumber === 'DBL-99',
    );
    expect(matches).toHaveLength(1);
    errors.assertZeroErrors();
  });

  test('T2-FD1-04: Invalid session UI /s/invalid-id-999 renders cleanly on mobile with zero pageerror', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ viewport: VIEWPORTS.mobile });
    try {
      const page = await ctx.newPage();
      const errors = attachErrorGuards(page);
      await page.goto('/s/invalid-id-999');
      await expect(page.locator('body')).toContainText(/not found|unavailable|create/i);
      await assertResponsiveUsability(page, 'mobile', errors);
    } finally {
      await ctx.close();
    }
  });

  test('T2-FD1-05: Pressing Enter in Staff studentNumber input submits entry cleanly', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const staff = new StaffPage(page);
    await staff.goto(`/s/${s.sessionId}`);
    await staff.join('Keyboard Proctor');

    await staff.selectSex('F');
    const input = Selectors.studentNumberInput(page);
    await input.fill('KEY-ENT-1');
    await input.press('Enter');

    await staff.expectQueuedVisible('F', 'KEY-ENT-1');
  });
});
