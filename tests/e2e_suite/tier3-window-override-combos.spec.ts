import { expect, test } from '@playwright/test';
import { ExamQApiClient } from './helpers/apiClient';
import { Selectors } from './helpers/selectors';
import { ControllerPage, HomePage, StaffPage } from './helpers/sessionPages';

const MIN = 60_000;

test.describe('Tier 3 — Window, Override & Reload Combinations (T3-11..T3-17)', () => {
  test('T3-11 (F-T1 x F-T2 x F-Q8): Staff transitions live from FIRST_30_MIN blocked to ALLOWED without reload', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const start = created.body.snapshot.serverNowMs;
    await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
      startTimeMs: start,
      durationMinutes: 120,
      clockOffsetMs: 10 * MIN,
    });

    const ctx = await browser.newContext();
    try {
      const staff = new StaffPage(await ctx.newPage());
      await staff.goto(`/s/${created.body.sessionId}`);
      await staff.join('Window Transition Staff');
      await staff.expectWindowStatus(/first 30|blocked|closed/i);

      await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
        startTimeMs: start,
        durationMinutes: 120,
        clockOffsetMs: 45 * MIN,
      });

      await staff.expectWindowStatus(/allowed|open/i);
      await staff.submitStudent('M', 'LIVE-OPEN-1');
      await staff.expectQueuedVisible('M', 'LIVE-OPEN-1');
    } finally {
      await ctx.close();
    }
  });

  test('T3-12 (F-T1 x F-T2 x F-T3): Clock enters LAST_20_MIN -> staff & normal enter block (403), override enter succeeds (200)', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const start = created.body.snapshot.serverNowMs;
    await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
      startTimeMs: start,
      durationMinutes: 120,
      clockOffsetMs: 45 * MIN,
    });
    const entry = await api.submitEntry(created.body.sessionId, {
      sex: 'F',
      studentNumber: 'L20-Q',
    });

    await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
      startTimeMs: start,
      durationMinutes: 120,
      clockOffsetMs: 105 * MIN,
    });

    const staffSub = await api.submitEntry(created.body.sessionId, {
      sex: 'M',
      studentNumber: 'L20-NEW',
    });
    expect(staffSub.status).toBe(403);

    const normalEnter = await api.entryAction(
      created.body.sessionId,
      entry.body.entry.id,
      created.body.controllerKey,
      { action: 'enter' },
    );
    expect(normalEnter.status).toBe(403);

    const ovrEnter = await api.entryAction(
      created.body.sessionId,
      entry.body.entry.id,
      created.body.controllerKey,
      { action: 'enter', override: true },
    );
    expect(ovrEnter.status).toBe(200);
  });

  test('T3-13 (F-T2 x F-T3 x F-Q8): During BEFORE_START, Controller Override entry syncs to Staff without granting override', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
      startTimeMs: created.body.snapshot.serverNowMs + 30 * MIN,
      durationMinutes: 120,
      clockOffsetMs: 0,
    });

    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      const staff = new StaffPage(page);
      await staff.goto(`/s/${created.body.sessionId}`);
      await staff.join('Pre-Start Staff');
      await expect(Selectors.overrideToggle(page)).toHaveCount(0);

      await api.submitEntry(
        created.body.sessionId,
        { sex: 'M', studentNumber: 'PRE-OVR-1', override: true },
        created.body.controllerKey,
      );
      await staff.expectQueuedVisible('M', 'PRE-OVR-1');
    } finally {
      await ctx.close();
    }
  });

  test('T3-14 (F-T1 x F-T2): Shortening exam duration mid-exam moves status from ALLOWED to LAST_20_MIN', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const start = created.body.snapshot.serverNowMs;

    const p1 = await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
      startTimeMs: start,
      durationMinutes: 90,
      clockOffsetMs: 40 * MIN,
    });
    expect(p1.body.snapshot.windowStatus).toBe('ALLOWED');

    const queued = await api.submitEntry(created.body.sessionId, {
      sex: 'M',
      studentNumber: 'SHORT-1',
    });
    expect(queued.status).toBe(201);

    const p2 = await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
      startTimeMs: start,
      durationMinutes: 55, // end-20m = 35m; effective 40m is LAST_20_MIN
      clockOffsetMs: 40 * MIN,
    });
    expect(p2.body.snapshot.windowStatus).toBe('LAST_20_MIN');

    const blocked = await api.submitEntry(created.body.sessionId, {
      sex: 'F',
      studentNumber: 'SHORT-2',
    });
    expect(blocked.status).toBe(403);

    const ovr = await api.entryAction(
      created.body.sessionId,
      queued.body.entry.id,
      created.body.controllerKey,
      { action: 'enter', override: true },
    );
    expect(ovr.status).toBe(200);
  });

  test('T3-15 (F-S3 x F-Q8 reload): Staff reloads /s/[id] -> sessionStorage retains identity and skips join prompt', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
      startTimeMs: created.body.snapshot.serverNowMs - 45 * MIN,
      durationMinutes: 120,
      clockOffsetMs: 0,
    });

    const staff = new StaffPage(page);
    await staff.goto(`/s/${created.body.sessionId}`);
    await staff.join('Persistent Proctor');
    await staff.submitStudent('M', 'PERSIST-M');

    await page.reload();
    await expect(Selectors.studentNumberInput(page)).toBeVisible();
    await expect(Selectors.staffLabelInput(page)).toHaveCount(0);
    await staff.expectQueuedVisible('M', 'PERSIST-M');
  });

  test('T3-16 (F-S4 x F-T1 reload): Controller reloads /s/[id] and retains controller privileges and exam config', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const { body: created } = await api.createSession();
    await api.patchConfig(created.sessionId, created.controllerKey, {
      startTimeMs: created.snapshot.serverNowMs - 45 * MIN,
      durationMinutes: 120,
      clockOffsetMs: 0,
    });

    const ctrl = new ControllerPage(page);
    await ctrl.goto(created.sessionId, created.controllerKey);
    await ctrl.expectWindowStatus(/allowed|open/i);

    await page.reload();
    await expect(Selectors.clearSessionButton(page)).toBeVisible();
    await ctrl.expectWindowStatus(/allowed|open/i);
  });

  test('T3-17 (F-S1 x F-S3 x F-T4): Create via /, join via / Join form, submit, then Clear resets joined client live', async ({
    browser,
  }) => {
    const cCtx = await browser.newContext();
    const sCtx = await browser.newContext();
    try {
      const cPage = await cCtx.newPage();
      const homeC = new HomePage(cPage);
      await homeC.goto();
      const { sessionId } = await homeC.createSession();

      const ctrl = new ControllerPage(cPage);
      await ctrl.configureExam({
        startTimeMs: Date.now() - 45 * MIN,
        durationMinutes: 120,
      });

      const sPage = await sCtx.newPage();
      const homeS = new HomePage(sPage);
      await homeS.goto();
      await homeS.joinByCode(sessionId);

      const staff = new StaffPage(sPage);
      await staff.join('Home Joiner');
      await staff.submitStudent('F', 'HOME-J1');
      await ctrl.expectQueuedVisible('F', 'HOME-J1');

      await ctrl.clearSession();
      await staff.expectQueuedAbsent('F', 'HOME-J1');
    } finally {
      await cCtx.close();
      await sCtx.close();
    }
  });
});
