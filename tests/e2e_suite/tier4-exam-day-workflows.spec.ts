import { expect, test, type BrowserContext } from '@playwright/test';
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
import { ControllerPage, StaffPage } from './helpers/sessionPages';

const MIN = 60_000;

test.describe('Tier 4 — Exam-Day Operational Workflows, Isolation & Persistence (T4-S06..T4-S12)', () => {
  test('T4-S06: Mid-exam late-joining staff and reload recovery render full live state and receive subsequent alerts', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    // Pre-populate mid-flight state: 1M+1F in bathroom, 4 queued, 2 returned
    const rM = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'RET-M0' });
    const rF = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'RET-F0' });
    await api.entryAction(s.sessionId, rM.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, rM.body.entry.id, s.controllerKey, { action: 'return' });
    await api.entryAction(s.sessionId, rF.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, rF.body.entry.id, s.controllerKey, { action: 'return' });

    const actM = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'IN-M1' });
    const actF = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'IN-F1' });
    await api.entryAction(s.sessionId, actM.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, actF.body.entry.id, s.controllerKey, { action: 'enter' });

    const qM1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'Q-M1' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'Q-M2' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'Q-F1' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'Q-F2' });

    const reloadCtx = await browser.newContext();
    const lateCtx = await browser.newContext();
    try {
      const stReload = new StaffPage(await reloadCtx.newPage());
      await stReload.goto(`/s/${s.sessionId}`);
      await stReload.join('Staff #3');
      await stReload.page.reload();

      const stLate = new StaffPage(await lateCtx.newPage());
      await stLate.goto(`/s/${s.sessionId}`);
      await stLate.join('Staff #7 Late');

      for (const st of [stReload, stLate]) {
        await st.expectInBathroom('M', 'IN-M1');
        await st.expectInBathroom('F', 'IN-F1');
        await st.expectQueuedOrder('M', ['Q-M1', 'Q-M2']);
        await st.expectQueuedOrder('F', ['Q-F1', 'Q-F2']);
      }

      // Advance Male queue so Q-M2 becomes next
      await api.entryAction(s.sessionId, actM.body.entry.id, s.controllerKey, { action: 'return' });
      await api.entryAction(s.sessionId, qM1.body.entry.id, s.controllerKey, { action: 'enter' });

      await stReload.expectAlertContains('Q-M2');
      await stLate.expectAlertContains('Q-M2');
    } finally {
      await reloadCtx.close();
      await lateCtx.close();
    }
  });

  test('T4-S07: Back-to-back exam sessions via Clear Session reset all 5 clients and allow student number reuse', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const contexts: BrowserContext[] = [];

    try {
      const ctrlCtx = await browser.newContext();
      contexts.push(ctrlCtx);
      const ctrl = new ControllerPage(await ctrlCtx.newPage());
      await ctrl.goto(s.sessionId, s.controllerKey);

      const staffList: StaffPage[] = [];
      for (let i = 0; i < 4; i++) {
        const ctx = await browser.newContext();
        contexts.push(ctx);
        const st = new StaffPage(await ctx.newPage());
        await st.goto(`/s/${s.sessionId}`);
        await st.join(`Proctor-${i + 1}`);
        staffList.push(st);
      }

      // Session 1 entries
      await staffList[0].submitStudent('M', 'REUSE-101');
      await staffList[1].submitStudent('F', 'REUSE-202');
      await ctrl.expectQueuedVisible('M', 'REUSE-101');
      await ctrl.enterStudent('M', 'REUSE-101');

      // Clear Session
      await ctrl.clearSession();
      for (const st of staffList) {
        await st.expectVacant('M');
        await st.expectQueuedAbsent('F', 'REUSE-202');
      }

      // Session 2 reuses same student numbers without staff re-joining
      await staffList[2].submitStudent('M', 'REUSE-101');
      await ctrl.expectQueuedVisible('M', 'REUSE-101');
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test('T4-S08: Concurrent multi-room isolation (Exam Hall A vs Exam Hall B)', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const hallA = await createConfiguredSession(api);
    const hallB = await createConfiguredSession(api);
    const contexts: BrowserContext[] = [];

    try {
      const cA = await browser.newContext();
      const sA = await browser.newContext();
      const cB = await browser.newContext();
      const sB = await browser.newContext();
      contexts.push(cA, sA, cB, sB);

      const ctrlA = new ControllerPage(await cA.newPage());
      const staffA = new StaffPage(await sA.newPage());
      const ctrlB = new ControllerPage(await cB.newPage());
      const staffB = new StaffPage(await sB.newPage());

      await ctrlA.goto(hallA.sessionId, hallA.controllerKey);
      await staffA.goto(`/s/${hallA.sessionId}`);
      await staffA.join('Hall A Staff');

      await ctrlB.goto(hallB.sessionId, hallB.controllerKey);
      await staffB.goto(`/s/${hallB.sessionId}`);
      await staffB.join('Hall B Staff');

      await staffA.submitStudent('M', 'HALLA-901');
      await staffB.submitStudent('F', 'HALLB-902');

      await ctrlA.expectQueuedVisible('M', 'HALLA-901');
      await ctrlB.expectQueuedVisible('F', 'HALLB-902');

      // Clear Hall A -> Hall B completely unaffected
      await ctrlA.clearSession();
      await staffA.expectQueuedAbsent('M', 'HALLA-901');
      await staffB.expectQueuedVisible('F', 'HALLB-902');
      await expect(Selectors.sexSection(ctrlB.page, 'M')).not.toContainText('HALLA-901');
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test('T4-S09: Stress ergonomics & layout audit across Desktop, Tablet, and Mobile with heavy queue state', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.joinStaff(s.sessionId, { label: 'S'.repeat(40) });

    const mAct = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'ACT-M99' });
    const fAct = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'ACT-F99' });
    await api.entryAction(s.sessionId, mAct.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, fAct.body.entry.id, s.controllerKey, { action: 'enter' });

    for (let i = 1; i <= 8; i++) {
      await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: `STRESS-M${i}` });
      await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: `STRESS-F${i}` });
    }

    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      const ctx = await browser.newContext({ viewport: vp });
      try {
        const ctrlPage = await ctx.newPage();
        const gCtrl = attachErrorGuards(ctrlPage);
        await new ControllerPage(ctrlPage).goto(s.sessionId, s.controllerKey);
        await assertResponsiveUsability(ctrlPage, `controller-${name}`, gCtrl);

        const stPage = await ctx.newPage();
        const gSt = attachErrorGuards(stPage);
        const staff = new StaffPage(stPage);
        await staff.goto(`/s/${s.sessionId}`);
        await staff.join('Stress Viewer');
        await assertResponsiveUsability(stPage, `staff-${name}`, gSt);
      } finally {
        await ctx.close();
      }
    }
  });

  test('T4-S10: 9-proctor simultaneous submission burst with duplicate-spotter conflict resolution', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const contexts: BrowserContext[] = [];

    try {
      const staffPages: StaffPage[] = [];
      for (let i = 0; i < 9; i++) {
        const ctx = await browser.newContext({ viewport: VIEWPORTS.mobile });
        contexts.push(ctx);
        const page = await ctx.newPage();
        const staff = new StaffPage(page);
        await staff.goto(`/s/${s.sessionId}`);
        await staff.join(`Burst-${i + 1}`);
        staffPages.push(staff);
      }

      // Proctors 0 and 1 both submit 'DUP-SPOT-55'; 2..8 submit unique students
      await Promise.all(
        staffPages.map((st, idx) => {
          const num = idx <= 1 ? 'DUP-SPOT-55' : `BURST-${idx + 1}`;
          const sex = idx % 2 === 0 ? 'M' : 'F';
          return st.submitStudent(sex, num);
        }),
      );

      await expect(async () => {
        const snap = await api.getSnapshot(s.sessionId);
        if (snap.body.unchanged) throw new Error('Expected snapshot');
        // 1 winner for DUP-SPOT-55 + 7 unique = 8 queued entries
        expect(snap.body.snapshot.entries).toHaveLength(8);
        expect(
          snap.body.snapshot.entries.filter((e) => e.studentNumber === 'DUP-SPOT-55'),
        ).toHaveLength(1);
      }).toPass();
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test('T4-S11: Unconfigured exam safety + emergency Controller Override + opening normal flow', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const { body: created } = await api.createSession(); // UNCONFIGURED

    const ctrlCtx = await browser.newContext();
    const staffCtx = await browser.newContext();
    try {
      const ctrl = new ControllerPage(await ctrlCtx.newPage());
      const staff = new StaffPage(await staffCtx.newPage());
      await ctrl.goto(created.sessionId, created.controllerKey);
      await staff.goto(`/s/${created.sessionId}`);
      await staff.join('Safety Staff');

      await staff.expectWindowStatus(/unconfigured|blocked|not configured/i);

      // Emergency override succeeds
      await ctrl.submitStudent('F', 'URGENT-MED', { override: true });
      await ctrl.expectQueuedVisible('F', 'URGENT-MED');
      await staff.expectQueuedVisible('F', 'URGENT-MED');

      // Configure allowed exam window -> normal staff submission opens
      await api.patchConfig(created.sessionId, created.controllerKey, {
        startTimeMs: Date.now() - 45 * MIN,
        durationMinutes: 120,
        clockOffsetMs: 0,
      });
      await staff.expectWindowStatus(/allowed|open/i);
      await staff.submitStudent('M', 'NORMAL-OPEN');
      await ctrl.expectQueuedVisible('M', 'NORMAL-OPEN');
    } finally {
      await ctrlCtx.close();
      await staffCtx.close();
    }
  });

  test('T4-S12: Deployment health, storage readiness, asset loading & cross-context persistence', async ({
    browser,
    playwright,
    request,
    baseURL,
  }) => {
    const api1 = new ExamQApiClient(request);
    const h = await api1.health();
    expect(h.status).toBe(200);
    expect(h.body.ok).toBe(true);
    expect(['file', 'upstash-redis']).toContain(h.body.storage);

    const s = await createConfiguredSession(api1);
    const ctx1 = await browser.newContext();
    try {
      const p1 = await ctx1.newPage();
      const failedAssets: Array<{ url: string; status: number }> = [];
      p1.on('response', (res) => {
        if (res.status() >= 400) {
          failedAssets.push({ url: res.url(), status: res.status() });
        }
      });
      const staff = new StaffPage(p1);
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('Persist Staff');
      await staff.submitStudent('M', 'PERSIST-S12');
      await staff.expectQueuedVisible('M', 'PERSIST-S12');
      expect(failedAssets).toEqual([]);
    } finally {
      await ctx1.close();
    }

    // Verify persistence in a brand-new APIRequestContext & BrowserContext
    const req2 = await playwright.request.newContext({ baseURL });
    const ctx2 = await browser.newContext();
    try {
      const api2 = new ExamQApiClient(req2);
      const snap = await api2.getSnapshot(s.sessionId);
      expect(snap.status).toBe(200);
      if (snap.body.unchanged) throw new Error('Expected snapshot');
      expect(snap.body.snapshot.entries.map((e) => e.studentNumber)).toContain(
        'PERSIST-S12',
      );

      const staff2 = new StaffPage(await ctx2.newPage());
      await staff2.goto(`/s/${s.sessionId}`);
      await staff2.join('Fresh Context');
      await staff2.expectQueuedVisible('M', 'PERSIST-S12');
    } finally {
      await req2.dispose();
      await ctx2.close();
    }
  });
});
