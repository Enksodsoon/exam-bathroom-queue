import { expect, test } from '@playwright/test';
import {
  ExamQApiClient,
  createConfiguredSession,
} from './helpers/apiClient';
import { Selectors } from './helpers/selectors';
import { ControllerPage, StaffPage } from './helpers/sessionPages';

test.describe('Tier 1 — Exam Time-Window & Session Lifecycle (F-T1..F-T4)', () => {
  // F-T1: Exam Config & Controllable Clock (5 tests)
  test('T1-FT1-01: PATCH /config sets startTimeMs and durationMinutes on snapshot.examConfig', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const startTimeMs = created.body.snapshot.serverNowMs - 40 * 60_000;

    const patched = await api.patchConfig(
      created.body.sessionId,
      created.body.controllerKey,
      { startTimeMs, durationMinutes: 120 },
    );
    expect(patched.status).toBe(200);
    expect(patched.body.snapshot.examConfig?.startTimeMs).toBe(startTimeMs);
    expect(patched.body.snapshot.examConfig?.durationMinutes).toBe(120);
  });

  test('T1-FT1-02: PATCH /config with clockOffsetMs updates effectiveNowMs and recalculates windowStatus', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const baseNow = created.body.snapshot.serverNowMs;
    const startTimeMs = baseNow;

    const patched = await api.patchConfig(
      created.body.sessionId,
      created.body.controllerKey,
      {
        startTimeMs,
        durationMinutes: 120,
        clockOffsetMs: 45 * 60_000,
      },
    );
    expect(patched.status).toBe(200);
    expect(patched.body.snapshot.effectiveNowMs).toBeGreaterThanOrEqual(
      startTimeMs + 44 * 60_000,
    );
    expect(patched.body.snapshot.windowStatus).toBe('ALLOWED');
  });

  test('T1-FT1-03: Updating examConfig a second time overrides values and increments version', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api, { durationMinutes: 120 });
    const v1 = s.snapshot.version;

    const p2 = await api.patchConfig(s.sessionId, s.controllerKey, {
      startTimeMs: s.snapshot.serverNowMs + 60 * 60_000,
      durationMinutes: 90,
      clockOffsetMs: 0,
    });
    expect(p2.status).toBe(200);
    expect(p2.body.snapshot.version).toBeGreaterThan(v1);
    expect(p2.body.snapshot.examConfig?.durationMinutes).toBe(90);
    expect(p2.body.snapshot.windowStatus).toBe('BEFORE_START');
  });

  test('T1-FT1-04: Controller Dashboard Exam Config form submits start time & duration and updates Window Status badge', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const { body: created } = await api.createSession();

    const ctrl = new ControllerPage(page);
    await ctrl.goto(created.sessionId, created.controllerKey);
    await ctrl.expectWindowStatus(/unconfigured/i);

    await ctrl.configureExam({
      startTimeMs: Date.now() - 45 * 60_000,
      durationMinutes: 120,
    });
    await ctrl.expectWindowStatus(/allowed|open/i);
  });

  test('T1-FT1-05: Changing clockOffsetMs updates Window Status badge on both Controller and Staff UIs', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const { body: created } = await api.createSession();
    const startTimeMs = created.snapshot.serverNowMs;
    await api.patchConfig(created.sessionId, created.controllerKey, {
      startTimeMs,
      durationMinutes: 120,
      clockOffsetMs: 5 * 60_000, // FIRST_30_MIN
    });

    const ctrlCtx = await browser.newContext();
    const staffCtx = await browser.newContext();
    try {
      const ctrl = new ControllerPage(await ctrlCtx.newPage());
      const staff = new StaffPage(await staffCtx.newPage());
      await ctrl.goto(created.sessionId, created.controllerKey);
      await staff.goto(`/s/${created.sessionId}`);
      await staff.join('Window Watcher');

      await ctrl.expectWindowStatus(/first 30|blocked|closed/i);
      await staff.expectWindowStatus(/first 30|blocked|closed/i);

      await api.patchConfig(created.sessionId, created.controllerKey, {
        startTimeMs,
        durationMinutes: 120,
        clockOffsetMs: 45 * 60_000, // ALLOWED
      });

      await ctrl.expectWindowStatus(/allowed|open/i);
      await staff.expectWindowStatus(/allowed|open/i);
    } finally {
      await ctrlCtx.close();
      await staffCtx.close();
    }
  });

  // F-T2: Time-Window Enforcement (5 tests)
  test('T1-FT2-01: Within [start+30m, end-20m) (ALLOWED), roaming staff submission returns 201', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const res = await api.submitEntry(s.sessionId, {
      sex: 'M',
      studentNumber: 'WIN-OK',
    });
    expect(res.status).toBe(201);
  });

  test('T1-FT2-02: With windowStatus=ALLOWED, controller enter without override returns 200', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const e = await api.submitEntry(s.sessionId, {
      sex: 'F',
      studentNumber: 'WIN-ENT',
    });

    const act = await api.entryAction(s.sessionId, e.body.entry.id, s.controllerKey, {
      action: 'enter',
    });
    expect(act.status).toBe(200);
  });

  test('T1-FT2-03: In ALLOWED window, Roaming Staff UI displays open status and enables submission', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const staff = new StaffPage(page);
    await staff.goto(`/s/${s.sessionId}`);
    await staff.join('Allowed Staff');
    await staff.expectWindowStatus(/allowed|open/i);
    await staff.submitStudent('M', 'UI-WIN-OK');
    await staff.expectQueuedVisible('M', 'UI-WIN-OK');
  });

  test('T1-FT2-04: Outside window (FIRST_30_MIN / LAST_20_MIN), staff submission returns 403 OUTSIDE_TIME_WINDOW', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const { body: created } = await api.createSession();
    const now = created.snapshot.serverNowMs;
    await api.patchConfig(created.sessionId, created.controllerKey, {
      startTimeMs: now,
      durationMinutes: 120,
      clockOffsetMs: 10 * 60_000, // FIRST_30_MIN
    });

    const res1 = await api.submitEntry(created.sessionId, {
      sex: 'M',
      studentNumber: 'BLK-1',
    });
    expect(res1.status).toBe(403);
    expect(res1.body.code).toBe('OUTSIDE_TIME_WINDOW');
    expect(res1.body.windowStatus).toBe('FIRST_30_MIN');

    await api.patchConfig(created.sessionId, created.controllerKey, {
      startTimeMs: now,
      durationMinutes: 120,
      clockOffsetMs: 105 * 60_000, // LAST_20_MIN
    });

    const res2 = await api.submitEntry(created.sessionId, {
      sex: 'F',
      studentNumber: 'BLK-2',
    });
    expect(res2.status).toBe(403);
    expect(res2.body.code).toBe('OUTSIDE_TIME_WINDOW');
    expect(res2.body.windowStatus).toBe('LAST_20_MIN');
  });

  test('T1-FT2-05: Outside window, Roaming Staff UI communicates blocked window and prevents adding entry', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const { body: created } = await api.createSession();
    await api.patchConfig(created.sessionId, created.controllerKey, {
      startTimeMs: created.snapshot.serverNowMs,
      durationMinutes: 120,
      clockOffsetMs: 5 * 60_000,
    });

    const staff = new StaffPage(page);
    await staff.goto(`/s/${created.sessionId}`);
    await staff.join('Blocked Staff');
    await staff.expectWindowStatus(/first 30|blocked|closed/i);

    const submitBtn = Selectors.submitStudentButton(page);
    if (await submitBtn.isEnabled()) {
      await staff.submitStudent('M', 'SHOULD-BLOCK');
      await expect(Selectors.sexSection(page, 'M')).not.toContainText('SHOULD-BLOCK');
    } else {
      await expect(submitBtn).toBeDisabled();
    }
  });

  // F-T3: Controller Override (5 tests)
  test('T1-FT3-01: Controller POST /entries with override=true succeeds during FIRST_30_MIN', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const { body: created } = await api.createSession();
    await api.patchConfig(created.sessionId, created.controllerKey, {
      startTimeMs: created.snapshot.serverNowMs,
      durationMinutes: 120,
      clockOffsetMs: 10 * 60_000,
    });

    const res = await api.submitEntry(
      created.sessionId,
      { sex: 'M', studentNumber: 'OVR-1', override: true },
      created.controllerKey,
    );
    expect(res.status).toBe(201);
    expect(res.body.entry.override).toBe(true);
  });

  test('T1-FT3-02: Controller POST /entries with override=true succeeds during LAST_20_MIN', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const { body: created } = await api.createSession();
    await api.patchConfig(created.sessionId, created.controllerKey, {
      startTimeMs: created.snapshot.serverNowMs,
      durationMinutes: 120,
      clockOffsetMs: 110 * 60_000,
    });

    const res = await api.submitEntry(
      created.sessionId,
      { sex: 'F', studentNumber: 'OVR-2', override: true },
      created.controllerKey,
    );
    expect(res.status).toBe(201);
    expect(res.body.entry.override).toBe(true);
  });

  test('T1-FT3-03: Controller action enter with override=true succeeds outside allowed window', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const { body: created } = await api.createSession();
    await api.patchConfig(created.sessionId, created.controllerKey, {
      startTimeMs: created.snapshot.serverNowMs,
      durationMinutes: 120,
      clockOffsetMs: 5 * 60_000,
    });

    const added = await api.submitEntry(
      created.sessionId,
      { sex: 'M', studentNumber: 'OVR-ENT', override: true },
      created.controllerKey,
    );
    const act = await api.entryAction(
      created.sessionId,
      added.body.entry.id,
      created.controllerKey,
      { action: 'enter', override: true },
    );
    expect(act.status).toBe(200);
    expect(
      act.body.snapshot.entries.find((e) => e.id === added.body.entry.id)?.status,
    ).toBe('in_bathroom');
  });

  test('T1-FT3-04: Controller UI toggles Override ON and submits student during blocked window', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const { body: created } = await api.createSession();
    await api.patchConfig(created.sessionId, created.controllerKey, {
      startTimeMs: created.snapshot.serverNowMs,
      durationMinutes: 120,
      clockOffsetMs: 5 * 60_000,
    });

    const ctrl = new ControllerPage(page);
    await ctrl.goto(created.sessionId, created.controllerKey);
    await ctrl.submitStudent('M', 'UI-OVR-1', { override: true });
    await ctrl.expectQueuedVisible('M', 'UI-OVR-1');
  });

  test('T1-FT3-05: Controller marks queued student in_bathroom via Override during blocked window across clients', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const { body: created } = await api.createSession();
    await api.patchConfig(created.sessionId, created.controllerKey, {
      startTimeMs: created.snapshot.serverNowMs,
      durationMinutes: 120,
      clockOffsetMs: 110 * 60_000, // LAST_20_MIN
    });
    await api.submitEntry(
      created.sessionId,
      { sex: 'F', studentNumber: 'UI-OVR-ENT', override: true },
      created.controllerKey,
    );

    const ctrlCtx = await browser.newContext();
    const staffCtx = await browser.newContext();
    try {
      const ctrl = new ControllerPage(await ctrlCtx.newPage());
      const staff = new StaffPage(await staffCtx.newPage());
      await ctrl.goto(created.sessionId, created.controllerKey);
      await staff.goto(`/s/${created.sessionId}`);
      await staff.join('Late Observer');

      await ctrl.enterStudent('F', 'UI-OVR-ENT', { override: true });
      await ctrl.expectInBathroom('F', 'UI-OVR-ENT');
      await staff.expectInBathroom('F', 'UI-OVR-ENT');
    } finally {
      await ctrlCtx.close();
      await staffCtx.close();
    }
  });

  // F-T4: Clear Session (5 tests)
  test('T1-FT4-01: POST /clear removes all queued entries and resets nextBySex to null', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'C1' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'C2' });

    const clr = await api.clear(s.sessionId, s.controllerKey, { force: true });
    expect(clr.status).toBe(200);
    expect(clr.body.snapshot.entries).toEqual([]);
    expect(clr.body.snapshot.nextBySex).toEqual({ M: null, F: null });
  });

  test('T1-FT4-02: POST /clear removes in_bathroom entries and frees both Male and Female slots', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'CM' });
    const f = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'CF' });
    await api.entryAction(s.sessionId, m.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, f.body.entry.id, s.controllerKey, { action: 'enter' });

    const clr = await api.clear(s.sessionId, s.controllerKey, { force: true });
    expect(clr.status).toBe(200);
    expect(clr.body.snapshot.entries).toEqual([]);

    const mNew = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'CM' });
    expect(mNew.status).toBe(201);
  });

  test('T1-FT4-03: POST /clear wipes returned and removed entries and increments clearedSeq', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const seq0 = s.snapshot.clearedSeq;
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'R1' });
    const f1 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'R2' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'return' });
    await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, { action: 'remove' });

    const clr = await api.clear(s.sessionId, s.controllerKey, { force: true });
    expect(clr.status).toBe(200);
    expect(clr.body.snapshot.entries).toEqual([]);
    expect(clr.body.snapshot.clearedSeq).toBeGreaterThan(seq0);
  });

  test('T1-FT4-04: Controller UI Clear Session wipes queues and occupancy immediately', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'UI-CLR-M' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'UI-CLR-F' });
    await api.entryAction(s.sessionId, m.body.entry.id, s.controllerKey, { action: 'enter' });

    const ctrl = new ControllerPage(page);
    await ctrl.goto(s.sessionId, s.controllerKey);
    await ctrl.expectInBathroom('M', 'UI-CLR-M');
    await ctrl.expectQueuedVisible('F', 'UI-CLR-F');

    await ctrl.clearSession();
    await ctrl.expectVacant('M');
    await expect(Selectors.sexSection(page, 'F')).not.toContainText('UI-CLR-F');
  });

  test('T1-FT4-05: Clear Session propagates to connected Staff clients, resetting display without reload', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'PROP-M' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'PROP-F' });
    await api.entryAction(s.sessionId, m.body.entry.id, s.controllerKey, { action: 'enter' });

    const ctrlCtx = await browser.newContext();
    const staffCtx = await browser.newContext();
    try {
      const ctrl = new ControllerPage(await ctrlCtx.newPage());
      const staff = new StaffPage(await staffCtx.newPage());
      await ctrl.goto(s.sessionId, s.controllerKey);
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('Reset Watcher');

      await staff.expectInBathroom('M', 'PROP-M');
      await staff.expectQueuedVisible('F', 'PROP-F');

      await ctrl.clearSession();
      await staff.expectVacant('M');
      await staff.expectQueuedAbsent('F', 'PROP-F');
    } finally {
      await ctrlCtx.close();
      await staffCtx.close();
    }
  });
});
